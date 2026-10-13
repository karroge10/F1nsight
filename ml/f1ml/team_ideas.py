import json

import numpy as np

from f1ml import paths

FORM_COLS = ['t_fast_qgap', 't_fast_fin', 't_form_step', 't_form_age']
SIM_COLS = ['t_sim_qgap', 't_sim_support']
PARAM_PATH = paths.ML_DIR / 'scripts' / 'exp_ideas' / 'params.json'


def form_features(qgap, finish, seasons, season, params):
    values = dict.fromkeys(FORM_COLS, np.nan)
    valid = np.isfinite(qgap)
    qgap = qgap[valid]
    finish = finish[valid]
    seasons = seasons[valid]
    if not len(qgap):
        return values
    count = len(qgap)
    ages = np.arange(count)[::-1]
    weights = np.power(0.5, ages / params['half_life'])
    reset = season in (2006, 2009, 2014, 2017, 2022, 2026)
    if reset:
        weights = weights * np.where(seasons < season, params['reset_discount'], 1.0)
    split = 0
    step = 0.0
    for end in range(6, count + 1):
        recent = qgap[end - 2:end].mean()
        old = qgap[max(0, end - 8):end - 2].mean()
        difference = recent - old
        if abs(difference) >= params['threshold']:
            split = end - 2
            step = difference
    if split:
        weights[:split] *= params['old_discount']
    values['t_fast_qgap'] = weighted_mean(qgap, weights)
    values['t_fast_fin'] = weighted_mean(finish, weights)
    values['t_form_step'] = step
    values['t_form_age'] = count - split if split else count
    return values


def similarity_features(qgap, race_ids, races, target_id, params):
    values = dict.fromkeys(SIM_COLS, np.nan)
    history = races.loc[race_ids]
    target = races.loc[target_id]
    length = history['courseLengthKm'].to_numpy(dtype=float)
    turns = history['turns'].to_numpy(dtype=float)
    street = (history['circuitType'] == 'STREET').to_numpy(dtype=float)
    target_street = float(target['circuitType'] == 'STREET')
    distance = ((length - target['courseLengthKm']) / 2.0) ** 2
    distance += ((turns - target['turns']) / 8.0) ** 2
    distance += 2.0 * (street - target_street) ** 2
    kernel = np.exp(-distance / (2.0 * params['bandwidth'] ** 2))
    count = len(qgap)
    residual = np.full(count, np.nan)
    for index in range(3, count):
        previous = qgap[max(0, index - 12):index]
        previous_count = len(previous)
        ages = np.arange(previous_count)[::-1]
        weights = np.power(0.5, ages / 3.0)
        mean = weighted_mean(previous, weights)
        residual[index] = qgap[index] - mean
    ages = np.arange(count)[::-1]
    recency = np.power(0.5, ages / 12.0)
    weights = kernel * recency
    valid = np.isfinite(residual) & np.isfinite(weights)
    support = weights[valid].sum()
    if support <= 0:
        return values
    total = (residual[valid] * weights[valid]).sum()
    values['t_sim_qgap'] = total / (support + params['shrinkage'])
    values['t_sim_support'] = support
    return values


def load_params():
    text = PARAM_PATH.read_text(encoding='utf-8')
    return json.loads(text)


def weighted_mean(values, weights):
    valid = np.isfinite(values) & np.isfinite(weights)
    if not valid.any():
        return np.nan
    total = (values[valid] * weights[valid]).sum()
    support = weights[valid].sum()
    return float(total / support)
