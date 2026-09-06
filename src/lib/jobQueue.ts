/** 弱网/失败任务队列 */

export type PendingJob = {
  id: string;
  kind: "chapter" | "beats";
  chapterId: string;
  chapterTitle: string;
  error: string;
  createdAt: string;
  attempts: number;
};

export type JobQueueFile = { jobs: PendingJob[] };

function isNetworkish(msg: string) {
  return /网络|超时|timeout|econn|enotfound|fetch failed|429|502|503|全部候选失败|upstream/i.test(
    msg
  );
}

export function shouldEnqueue(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/已取消|abort/i.test(msg)) return false;
  return isNetworkish(msg);
}

export async function loadJobQueue(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<JobQueueFile> {
  if (!window.moshu) return { jobs: [] };
  return window.moshu.readJson<JobQueueFile>(
    await join(root, "continuity", "pending-jobs.json"),
    { jobs: [] }
  );
}

export async function saveJobQueue(
  root: string,
  join: (...p: string[]) => Promise<string>,
  data: JobQueueFile
) {
  if (!window.moshu) return;
  await window.moshu.writeJson(await join(root, "continuity", "pending-jobs.json"), data);
}

export async function enqueueJob(
  root: string,
  join: (...p: string[]) => Promise<string>,
  job: Omit<PendingJob, "id" | "createdAt" | "attempts"> & { attempts?: number }
) {
  const q = await loadJobQueue(root, join);
  const existing = q.jobs.findIndex(
    (j) => j.kind === job.kind && j.chapterId === job.chapterId
  );
  const next: PendingJob = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    attempts: job.attempts ?? 0,
    kind: job.kind,
    chapterId: job.chapterId,
    chapterTitle: job.chapterTitle,
    error: job.error,
  };
  if (existing >= 0) {
    next.attempts = (q.jobs[existing].attempts || 0) + 1;
    q.jobs[existing] = next;
  } else {
    q.jobs.unshift(next);
  }
  q.jobs = q.jobs.slice(0, 40);
  await saveJobQueue(root, join, q);
  return next;
}

export async function removeJob(
  root: string,
  join: (...p: string[]) => Promise<string>,
  jobId: string
) {
  const q = await loadJobQueue(root, join);
  q.jobs = q.jobs.filter((j) => j.id !== jobId);
  await saveJobQueue(root, join, q);
}

export async function clearJobQueue(
  root: string,
  join: (...p: string[]) => Promise<string>
) {
  await saveJobQueue(root, join, { jobs: [] });
}
