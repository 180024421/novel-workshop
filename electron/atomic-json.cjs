// 原子写 JSON：先写临时文件 + fsync，再 rename 覆盖目标。
// Windows 上 rename 覆盖已存在文件通常可行（MoveFileEx REPLACE_EXISTING），
// 但杀软/索引器/OneDrive 同步可能瞬时占用目标文件导致 EPERM——
// 因此失败时先 unlink 目标重试（最多 3 次退避），最终降级为直接写，保证不丢数据。
const fs = require("fs/promises");
const path = require("path");

function tmpName(file) {
  return `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function writeJsonAtomic(file, data) {
  const json = JSON.stringify(data, null, 2);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = tmpName(file);
    try {
      await fs.writeFile(tmp, json, "utf8");
      let handle;
      try {
        handle = await fs.open(tmp, "r");
        await handle.sync();
      } finally {
        await handle?.close();
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await fs.rename(tmp, file);
          return;
        } catch (e) {
          if (e && (e.code === "EPERM" || e.code === "EBUSY")) {
            try {
              await fs.unlink(file);
            } catch {
              /* target may not exist */
            }
            await sleep(20 * (attempt + 1));
            continue;
          }
          throw e;
        }
      }
      await fs.rename(tmp, file);
    } catch (e) {
      try {
        await fs.rm(tmp, { force: true });
      } catch {
        /* ignore */
      }
      throw e;
    }
  } catch {
    // 降级路径：原子写失败也要把数据写下去
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, json, "utf8");
  }
}

module.exports = { writeJsonAtomic };
