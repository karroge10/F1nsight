// F1nsight alarm clock: a Cloudflare Worker whose cron triggers start the GitHub Actions
// workflows on time. GitHub's own `schedule` runs late, or not at all for hours; the dispatch
// API does not. Each dispatch passes gate=true, so the workflow still stops in about a minute
// when nothing is due, exactly like a scheduled run.
//
// Deploy from this folder with `npx wrangler deploy` (wrangler logged in to the account that
// hosts the f1nsight Pages project). The secret GITHUB_TOKEN is a fine-grained token for this
// repository with Actions read and write; set-token.ps1 stores a new one here and as the GitHub
// secret F1_DISPATCH_TOKEN.

const REPO = "karroge10/F1nsight";
const BRANCH = "master";
const WORKFLOW_BY_CRON = {
  "7,37 * * * *": "refresh.yml",
  "23 * * * *": "retrain-live.yml",
};

export default {
  async scheduled(controller, env) {
    const workflow = WORKFLOW_BY_CRON[controller.cron];
    if (!workflow) {
      throw new Error(`no workflow for cron "${controller.cron}"`);
    }
    await dispatch(env.GITHUB_TOKEN, workflow);
  },
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function dispatch(token, workflow) {
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`;
  const body = JSON.stringify({ ref: BRANCH, inputs: { gate: "true" } });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "f1nsight-cron",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`dispatch ${workflow} failed: ${response.status} ${text}`);
  }
  console.log(`dispatched ${workflow}`);
}
