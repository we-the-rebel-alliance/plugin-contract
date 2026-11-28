/**
 * `audit`: the evidence an auditor asks for — what each installed plugin may read and do for one person, and the grant
 * behind each declaration (contract §6, §7, §8 and §13; issues #83, #94 and #95).
 *
 *   const report = auditReport({ person, installed: listing.plugins, options, grants })
 *   const markdown = renderAuditReport(report)
 *
 * The report is plain data and validates against `dist/schemas/audit.json`. It is deterministic, carries no credential,
 * token or provider value, and puts a grant whose plugin, source or action is not installed under `problems` rather
 * than dropping it or throwing.
 */
export { AUDIT_REPORT_SCHEMA, auditReport } from "./audit/report.ts"
export type {
  AuditAccess,
  AuditAction,
  AuditConfirmation,
  AuditGrant,
  AuditGrantRecord,
  AuditInput,
  AuditMethod,
  AuditPlugin,
  AuditProblem,
  AuditReport,
  AuditSource,
} from "./audit/report.ts"
export { renderAuditReport } from "./audit/render.ts"
