import { NextRequest, NextResponse } from 'next/server';
import {
  getSession,
  getWorkflowDetail,
  getLatestWorkflowDetailBySession,
} from '@/lib/db';
import { buildWorkflowViewFromRecords } from '@/lib/workflow-view-reducer';

export const runtime = 'nodejs';

/**
 * GET /api/workflows
 *
 * Reconstructs a dynamic-workflow run for the P2 WorkflowView when the live
 * SSE snapshot is gone (page reload / session re-open). Returns a render-ready
 * WorkflowViewState rather than raw rows so the client shares the same shape
 * the reducer produces from live events.
 *
 * Query params (one of):
 *   - workflow_id=<id>           → that specific workflow
 *   - session_id=<id>            → the session's most recent workflow
 *
 * Response: { workflow: WorkflowViewState | null }
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflow_id');
    const sessionId = searchParams.get('session_id');

    if (!workflowId && !sessionId) {
      return NextResponse.json(
        { error: 'workflow_id or session_id is required' },
        { status: 400 },
      );
    }

    const detail = workflowId
      ? getWorkflowDetail(workflowId)
      : getLatestWorkflowDetailBySession(sessionId!);

    if (!detail) {
      // No workflow for this session/id is a normal state, not an error.
      return NextResponse.json({ workflow: null });
    }

    // When querying by session, scope to that session for safety.
    if (sessionId && detail.workflow.session_id !== sessionId) {
      return NextResponse.json({ workflow: null });
    }
    // Validate the owning session still exists (avoid leaking orphaned rows).
    if (!getSession(detail.workflow.session_id)) {
      return NextResponse.json({ workflow: null });
    }

    const workflow = buildWorkflowViewFromRecords(
      detail.workflow,
      detail.steps,
      detail.attemptsByStep,
    );
    return NextResponse.json({ workflow });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to load workflow';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
