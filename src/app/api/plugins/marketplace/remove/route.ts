import { NextResponse } from "next/server";
import { spawn } from "child_process";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { plugin, global: isGlobal } = body as { plugin: string; global?: boolean };

    if (!plugin || typeof plugin !== "string") {
      return NextResponse.json(
        { error: "plugin name is required" },
        { status: 400 }
      );
    }

    const args = ["plugin", "remove", plugin, "-y"];
    if (isGlobal) {
      args.splice(3, 0, "-g");
    }

    const child = spawn("npx", args, {
      env: { ...process.env },
      shell: true,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: string) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        child.stdout?.on("data", (chunk: Buffer) => {
          send("output", chunk.toString());
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          send("output", chunk.toString());
        });

        child.on("close", (code) => {
          if (code === 0) {
            send("done", "Uninstall completed successfully");
          } else {
            send("error", `Process exited with code ${code}`);
          }
          controller.close();
        });

        child.on("error", (err) => {
          send("error", err.message);
          controller.close();
        });
      },
      cancel() {
        child.kill();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[marketplace/plugin/remove] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Remove failed" },
      { status: 500 }
    );
  }
}
