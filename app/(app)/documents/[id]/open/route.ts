import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/viewer";

/**
 * Open a document from a work order (`?wo=`). Logs who opened which revision
 * while the work order is open; on closed work it opens the revision the work
 * order kept. Then shows that revision.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const woId = req.nextUrl.searchParams.get("wo");
  const target = new URL(`/documents/${id}`, req.url);
  if (!woId) return NextResponse.redirect(target);
  const { repo, profile } = await getViewer();
  try {
    const revId = await repo.openWoDocument(woId, id, profile.id);
    target.searchParams.set("rev", revId);
    target.searchParams.set("wo", woId);
  } catch (error) {
    console.error("Open document failed", error);
    target.searchParams.set("wo", woId);
  }
  return NextResponse.redirect(target, { status: 303 });
}
