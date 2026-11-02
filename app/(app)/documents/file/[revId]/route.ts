import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/viewer";

/**
 * A revision's file. Seed files and live storage files redirect (live: a
 * short-lived signed URL); demo uploads are served from memory. An uploaded
 * SVG is served sandboxed, so script in it can't run here (a sandbox would
 * also stop the browser's PDF viewer, so PDFs don't get one).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ revId: string }> }) {
  const { revId } = await params;
  const { repo } = await getViewer();
  const file = await repo.getRevisionFile(revId);
  if (!file) return new NextResponse("Not found", { status: 404 });
  if ("url" in file) return NextResponse.redirect(new URL(file.url, req.url));
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(Buffer.from(file.data), {
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${file.name.replace(/[^A-Za-z0-9._ -]/g, "_")}"`,
      ...(file.mime === "image/svg+xml" ? { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" } : {}),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
