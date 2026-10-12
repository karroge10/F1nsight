"""Set transformer over the entrants of a race, trained on the GPU with listwise losses.

One network serves all three forecast stages: each race appears three times in training, with
the inputs a stage may not see blanked (`features.stage_frame`) and a stage one-hot added. The
encoder lets every driver attend to the whole field, so scores are relative by construction.

Heads (per driver):
- race score, trained with the Plackett-Luce negative log likelihood of the classified order;
- qualifying score, Plackett-Luce over the qualifying order;
- DNF logit, binary cross entropy.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import torch
from torch import nn

from f1ml import features as feat

DEFAULT_NN_PARAMS = {
    "d_model": 64,
    "layers": 2,
    "heads": 4,
    "dropout": 0.15,
    "lr": 1.5e-3,
    "weight_decay": 1e-3,
    "epochs": 60,
    "batch": 64,
    "quali_weight": 0.5,
    "dnf_weight": 2.0,
    "decay": 0.85,
    "seeds": 3,
}
MAX_FIELD = 26
STAGE_INDEX = {stage: i for i, stage in enumerate(feat.STAGES)}


@dataclass
class Preprocessor:
    columns: list[str]
    mean: np.ndarray
    std: np.ndarray

    @classmethod
    def fit(cls, frame: pd.DataFrame, columns: list[str]) -> "Preprocessor":
        values = frame[columns].to_numpy(dtype=float)
        mean = np.nanmean(values, axis=0)
        std = np.nanstd(values, axis=0)
        mean = np.where(np.isnan(mean), 0.0, mean)
        std = np.where(np.isnan(std) | (std < 1e-6), 1.0, std)
        return cls(columns, mean, std)

    def transform(self, frame: pd.DataFrame) -> np.ndarray:
        values = frame[self.columns].to_numpy(dtype=float)
        scaled = (values - self.mean) / self.std
        missing = np.isnan(scaled)
        scaled = np.where(missing, 0.0, np.clip(scaled, -6.0, 6.0))
        return np.concatenate([scaled, missing.astype(float)], axis=1)


@dataclass
class SetModel:
    preprocessor: Preprocessor
    params: dict
    networks: list = field(default_factory=list)
    train_seconds: float = 0.0

    def predict(self, frame: pd.DataFrame, stage: str) -> dict[str, np.ndarray]:
        """Race score, quali score and DNF logit per row (seed ensemble average)."""
        gated = feat.stage_frame(frame, stage)
        batch = _race_batches(gated, self.preprocessor, stage)
        device = pick_device()
        outputs = {"race": [], "quali": [], "dnf": []}
        for network in self.networks:
            network.eval()
            with torch.no_grad():
                x = torch.as_tensor(batch["x"], device=device)
                pad = torch.as_tensor(batch["pad"], device=device)
                race, quali, dnf = network(x, pad)
            outputs["race"].append(race.cpu().numpy())
            outputs["quali"].append(quali.cpu().numpy())
            outputs["dnf"].append(dnf.cpu().numpy())
        result = {}
        for key, stacked in outputs.items():
            mean = np.mean(stacked, axis=0)
            result[key] = _unpad(mean, batch["slots"], len(frame))
        return result


class SetTransformer(nn.Module):
    def __init__(self, input_dim: int, d_model: int, layers: int, heads: int, dropout: float):
        super().__init__()
        self.embed = nn.Sequential(
            nn.Linear(input_dim, d_model), nn.GELU(), nn.Dropout(dropout),
            nn.Linear(d_model, d_model),
        )
        layer = nn.TransformerEncoderLayer(d_model, heads, dim_feedforward=2 * d_model,
                                           dropout=dropout, batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(layer, layers, enable_nested_tensor=False)
        self.race_head = nn.Sequential(nn.LayerNorm(d_model), nn.Linear(d_model, 1))
        self.quali_head = nn.Sequential(nn.LayerNorm(d_model), nn.Linear(d_model, 1))
        self.dnf_head = nn.Sequential(nn.LayerNorm(d_model), nn.Linear(d_model, 1))

    def forward(self, x: torch.Tensor, pad: torch.Tensor):
        hidden = self.embed(x)
        encoded = self.encoder(hidden, src_key_padding_mask=pad)
        race = self.race_head(encoded).squeeze(-1)
        quali = self.quali_head(encoded).squeeze(-1)
        dnf = self.dnf_head(encoded).squeeze(-1)
        return race, quali, dnf


def train_set_model(frame: pd.DataFrame, params: dict, verbose: bool = False) -> SetModel:
    """Train a seed ensemble on all three stage views of every race in `frame`."""
    started = time.time()
    columns = feat.stage_columns("post-qualifying")
    preprocessor = Preprocessor.fit(frame, columns)
    batches = []
    for stage in feat.STAGES:
        gated = feat.stage_frame(frame, stage)
        batch = _race_batches(gated, preprocessor, stage)
        batches.append(batch)
    tensors = _stack_batches(batches)
    seasons = tensors.pop("season")
    weights = np.power(params["decay"], seasons.max() - seasons)
    tensors["weight"] = weights.astype(np.float32)
    model = SetModel(preprocessor, params)
    seeds = int(params["seeds"])
    first_seed = int(params.get("seed", 0))
    for seed in range(first_seed, first_seed + seeds):
        network = _fit_network(tensors, params, seed, verbose)
        model.networks.append(network)
    model.train_seconds = time.time() - started
    return model


def plackett_luce_nll(scores: torch.Tensor, order: torch.Tensor, valid: torch.Tensor):
    """Batched PL negative log likelihood.

    scores: (B, N) driver scores; order: (B, N) driver slot indices in finishing order, padded;
    valid: (B, N) bool, True for the ranked prefix of `order`.
    """
    gathered = torch.gather(scores, 1, order)
    masked = torch.where(valid, gathered, torch.full_like(gathered, -1e4))
    flipped = torch.flip(masked, dims=[1])
    running = torch.flip(torch.logcumsumexp(flipped, dim=1), dims=[1])
    terms = torch.where(valid, running - gathered, torch.zeros_like(gathered))
    return terms.sum(dim=1)


def pick_device() -> torch.device:
    """CUDA when this machine has it, otherwise the CPU (GitHub Actions runners)."""
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


# ----------------------------------------------------------------------------------------------
# helpers


def _fit_network(tensors: dict, params: dict, seed: int, verbose: bool) -> SetTransformer:
    torch.manual_seed(seed)
    generator = np.random.default_rng(seed)
    device = pick_device()
    input_dim = tensors["x"].shape[-1]
    network = SetTransformer(input_dim, int(params["d_model"]), int(params["layers"]),
                             int(params["heads"]), params["dropout"]).to(device)
    optimizer = torch.optim.AdamW(network.parameters(), lr=params["lr"],
                                  weight_decay=params["weight_decay"])
    epochs = int(params["epochs"])
    races = tensors["x"].shape[0]
    batch_size = int(params["batch"])
    steps_per_epoch = math.ceil(races / batch_size)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=params["lr"],
                                                    total_steps=epochs * steps_per_epoch)
    gpu = {key: torch.as_tensor(value, device=device) for key, value in tensors.items()}
    for epoch in range(epochs):
        network.train()
        permutation = generator.permutation(races)
        epoch_loss = 0.0
        for step in range(steps_per_epoch):
            index_np = permutation[step * batch_size:(step + 1) * batch_size]
            index = torch.as_tensor(index_np, device=device)
            loss = _batch_loss(network, gpu, index, params)
            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(network.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            epoch_loss += float(loss.detach())
        if verbose and (epoch % 10 == 0 or epoch == epochs - 1):
            print(f"    seed {seed} epoch {epoch:3d} loss {epoch_loss / steps_per_epoch:.4f}")
    network.eval()
    return network


def _batch_loss(network, gpu: dict, index: torch.Tensor, params: dict) -> torch.Tensor:
    x = gpu["x"][index]
    pad = gpu["pad"][index]
    race, quali, dnf = network(x, pad)
    weight = gpu["weight"][index]
    race_nll = plackett_luce_nll(race, gpu["race_order"][index], gpu["race_valid"][index])
    quali_nll = plackett_luce_nll(quali, gpu["quali_order"][index], gpu["quali_valid"][index])
    dnf_target = gpu["dnf"][index]
    dnf_mask = gpu["dnf_mask"][index]
    bce = nn.functional.binary_cross_entropy_with_logits(dnf, dnf_target, reduction="none")
    dnf_loss = (bce * dnf_mask).sum(dim=1)
    total = race_nll + params["quali_weight"] * quali_nll + params["dnf_weight"] * dnf_loss
    return (total * weight).sum() / weight.sum()


def _race_batches(frame: pd.DataFrame, preprocessor: Preprocessor, stage: str) -> dict:
    """Pad every race to MAX_FIELD slots; add stage one-hot and race-centred inputs."""
    race_ids = frame["raceId"].to_numpy()
    unique_races, first_index = np.unique(race_ids, return_index=True)
    race_count = len(unique_races)
    base = preprocessor.transform(frame)
    stage_onehot = np.zeros((len(frame), len(feat.STAGES)))
    stage_onehot[:, STAGE_INDEX[stage]] = 1.0
    width = base.shape[1] * 2 + stage_onehot.shape[1]
    x = np.zeros((race_count, MAX_FIELD, width), dtype=np.float32)
    pad = np.ones((race_count, MAX_FIELD), dtype=bool)
    race_order = np.zeros((race_count, MAX_FIELD), dtype=np.int64)
    race_valid = np.zeros((race_count, MAX_FIELD), dtype=bool)
    quali_order = np.zeros((race_count, MAX_FIELD), dtype=np.int64)
    quali_valid = np.zeros((race_count, MAX_FIELD), dtype=bool)
    dnf = np.zeros((race_count, MAX_FIELD), dtype=np.float32)
    dnf_mask = np.zeros((race_count, MAX_FIELD), dtype=np.float32)
    season = np.zeros(race_count, dtype=float)
    slots = np.zeros((len(frame), 2), dtype=np.int64)
    finish = _column(frame, "y_finish")
    classified = _column(frame, "y_classified")
    quali = _column(frame, "y_quali")
    dnf_labels = _column(frame, "y_dnf")
    seasons = frame["season"].to_numpy(dtype=float)
    position_of_race = {race_id: i for i, race_id in enumerate(unique_races)}
    rows_by_race = pd.Series(np.arange(len(frame))).groupby(race_ids).indices
    for race_id, rows in rows_by_race.items():
        r = position_of_race[race_id]
        rows = rows[:MAX_FIELD]
        n = len(rows)
        race_base = base[rows]
        centred = race_base - race_base.mean(axis=0, keepdims=True)
        x[r, :n] = np.concatenate([race_base, centred, stage_onehot[rows]], axis=1)
        pad[r, :n] = False
        slots[rows, 0] = r
        slots[rows, 1] = np.arange(n)
        season[r] = seasons[rows[0]]
        ranked = [(finish[row], slot) for slot, row in enumerate(rows)
                  if classified[row] == 1 and finish[row] == finish[row]]
        _fill_order(race_order, race_valid, r, ranked)
        quali_ranked = [(quali[row], slot) for slot, row in enumerate(rows)
                        if quali[row] == quali[row]]
        _fill_order(quali_order, quali_valid, r, quali_ranked)
        for slot, row in enumerate(rows):
            if dnf_labels[row] == dnf_labels[row]:
                dnf[r, slot] = dnf_labels[row]
                dnf_mask[r, slot] = 1.0
    return {"x": x, "pad": pad, "race_order": race_order, "race_valid": race_valid,
            "quali_order": quali_order, "quali_valid": quali_valid, "dnf": dnf,
            "dnf_mask": dnf_mask, "season": season, "slots": slots}


def _fill_order(order: np.ndarray, valid: np.ndarray, race: int, ranked: list) -> None:
    ranked.sort()
    for position, (_, slot) in enumerate(ranked):
        order[race, position] = slot
        valid[race, position] = True


def _stack_batches(batches: list[dict]) -> dict:
    keys = [key for key in batches[0] if key != "slots"]
    return {key: np.concatenate([batch[key] for batch in batches], axis=0) for key in keys}


def _unpad(values: np.ndarray, slots: np.ndarray, rows: int) -> np.ndarray:
    result = np.zeros(rows, dtype=float)
    result[:] = values[slots[:, 0], slots[:, 1]]
    return result


def _column(frame: pd.DataFrame, name: str) -> np.ndarray:
    if name not in frame:
        return np.full(len(frame), np.nan)
    return frame[name].to_numpy(dtype=float)
