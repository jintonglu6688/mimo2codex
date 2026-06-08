# Design: data.db 体积治理 — 清理 + VACUUM + 自动运维 (issue #67)

- Date: 2026-06-08
- Status: Approved — scope **C 全套**, 默认值 a/a (新装生效, 老用户不动)

## 背景 / 诊断
- `data.db` 涨到 6G, 大头是 `chat_logs` 的 `request_body` / `response_body`。
- 默认 `bodyMode=full` + `retentionDays=off` → 无限膨胀。
- 后端**已有** retention / 每 6h maintenance / 手动删 (`deleteLogsBefore`), 但**从不 `VACUUM`** → 删行不缩文件 (SQLite 把空闲页留在 freelist)。
- `data.db` 含十几张配置表, **不能直接删文件**; 只有 `chat_logs` 是体积大头。

## 目标
1. **应急**: 一键清理旧日志 + `VACUUM`, 让现有 6G 立即降下来。
2. **治本**: 调默认存储策略, 避免再膨胀 (绝不动老用户已有数据)。
3. **可见**: dashboard / Logs 页显示 `data.db` 实时大小。
4. **自动运维**: 超大小阈值自动清理 + 节流 `VACUUM`。

## 决策: 默认值 (已批准 a/a)
| 项 | 新装 | 老用户 |
|----|------|--------|
| `logging.retentionDays` | **30** | 一次性写入显式 `off`, 锁定"不限制" |
| `logging.bodyMode` | **errors-only** | 一次性写入显式 `full`, 锁定现状 |

- 判定全新库 vs 已有库: 复用 `src/db/index.ts` 的首次建库 / migration 机制 (开发时读其 `schema_version` 逻辑确定挂载点)。
- 一次性迁移用一个 settings 标记 (如 `logging.defaultsSeeded`) 保证只跑一次, 之后用户在 UI 的任何修改都优先。

## 后端
### db 层 (`src/db/logs.ts` / 新 helper)
- `getDbSizeBytes()` → `{ total, main, wal, shm }`: stat `data.db` + `-wal` + `-shm` (路径取自 `src/db/dataDir.ts`)。
- `vacuumDb()` → `{ beforeBytes, afterBytes }`: `getDb().exec("VACUUM")` (不可在事务内)。
- `deleteAllLogs()` → `DELETE FROM chat_logs`。
- 复用 `deleteLogsBefore(ts)`。
- `diskFreeBytes(dir)`: `fs.statfsSync` (Node ≥ 18.15), VACUUM 前预检。

### API (`src/admin/router.ts`)
- `GET /admin/api/db/size` → 大小明细。
- `POST /admin/api/db/vacuum` → 预检磁盘 → VACUUM → `{ beforeBytes, afterBytes, freedBytes }`; 磁盘不足回 400。
- 清理复用 `DELETE /admin/api/logs`: 现有 `?before=` + 新增 `?keepDays=` / `?all=1`。

### 自动运维 (`src/logging/settings.ts` `runLogMaintenance`)
- 现有: 按 `retentionDays` 删行 (保留)。
- 新增 setting `logging.maxDbSizeMb` (默认 `null`=off): 超过则删最旧日志到 ~80% 目标。
- 删除后节流 VACUUM: 仅当本次删除量显著 **且** 距上次 VACUUM > 24h 才 `vacuumDb()` (记 `logging.lastVacuumAt`)。
- best-effort: 失败只 `log`, 不影响代理转发。

## VACUUM 策略
- **统一全量 `VACUUM`** (简单可靠; 放弃 `auto_vacuum=INCREMENTAL` — 它对已有库需先全量 VACUUM 才生效, 迁移坑大)。
- 手动 = 即时全量; 自动 = 节流全量 (限频 + 仅删除量大时)。
- 预检: 可用磁盘 ≥ 当前 db 大小才执行, 否则拒绝并提示。
- 锁库: 同步执行 (6G 可能数秒~数十秒), UI 显示"进行中"。

## 前端 (`web/`)
- `src/api/client.ts`: `getDbSize` / `vacuumDb` / `cleanupLogs`。
- **Dashboard**: 「数据库大小」卡片 (实时 + 超阈值警示色)。
- **Logs 页**: 「清理与压缩」区 — 按保留天数清理 / 清空全部 / 一键压缩 + 压缩前后大小 + 二次确认。
- **可见性**: 把 `retention` / `bodyMode` 设置提到 Logs 页显眼处, 配说明文案。
- i18n: `zh-CN` + `en-US` 全部新文案。

## 错误处理
- VACUUM 磁盘不足 → 400 + 清晰提示。
- VACUUM 期间阻塞 → 前端 loading 态。
- 自动维护失败 → 仅 log, 代理不受影响。

## 测试 (TDD)
- db: `getDbSizeBytes` / `vacuumDb` (删行后文件确实变小) / `deleteAllLogs` (临时 db)。
- 默认值迁移: 全新库 → 30 / errors-only; 已有库 → off / full; 只跑一次。
- API 端点: size / vacuum / cleanup。
- 自动运维: retention 触发 + 大小阈值触发。

## 任务分解
1. 后端 db 函数 (size / vacuum / deleteAll / diskFree) + 默认值迁移 — TDD。
2. 后端 API 端点 + `runLogMaintenance` 自动运维增强 — TDD。
3. 前端 dashboard 卡片 + Logs 清理/压缩 UI + 设置可见性 + i18n。
4. changelog (tag-log 中英 + release-notes) + 全量验证 (test + build)。
