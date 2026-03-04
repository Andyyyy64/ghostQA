import { execa, type ResultPromise } from "execa";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import consola from "consola";

/**
 * Records the Xvfb display as video using ffmpeg x11grab.
 */
export class DesktopRecorder {
  private ffmpegProcess: ResultPromise | null = null;
  private outputPath: string;

  constructor(
    private display: string,
    private outputDir: string,
    private resolution: { width: number; height: number } = { width: 1280, height: 720 }
  ) {
    this.outputPath = join(outputDir, "videos", "desktop-recording.mp4");
  }

  async startRecording(): Promise<void> {
    await mkdir(join(this.outputDir, "videos"), { recursive: true });

    const videoSize = `${this.resolution.width}x${this.resolution.height}`;
    consola.info(`Recording desktop (${this.display}) at ${videoSize}`);

    this.ffmpegProcess = execa("ffmpeg", [
      "-y",                           // Overwrite output
      "-f", "x11grab",                // X11 screen capture
      "-video_size", videoSize,
      "-framerate", "10",             // 10 fps is enough for QA
      "-i", this.display,             // Display to capture
      "-c:v", "libx264",
      "-preset", "ultrafast",         // Fast encoding
      "-pix_fmt", "yuv420p",          // Widely compatible format
      "-crf", "28",                   // Reasonable quality
      this.outputPath,
    ], {
      reject: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Don't await — runs in background
    this.ffmpegProcess.catch(() => {});

    // Give ffmpeg a moment to start
    await new Promise((r) => setTimeout(r, 500));
    consola.info(`Desktop recording started: ${this.outputPath}`);
  }

  async stopRecording(): Promise<string> {
    if (!this.ffmpegProcess) {
      return this.outputPath;
    }

    consola.info("Stopping desktop recording...");

    // Send 'q' to ffmpeg stdin for graceful shutdown
    try {
      this.ffmpegProcess.stdin?.write("q");
      this.ffmpegProcess.stdin?.end();
    } catch {
      // stdin might be closed
    }

    // Wait for process to finish, with timeout
    const timeout = setTimeout(() => {
      this.ffmpegProcess?.kill("SIGKILL");
    }, 5000);

    try {
      await this.ffmpegProcess;
    } catch {
      // Expected — process was terminated
    }

    clearTimeout(timeout);
    this.ffmpegProcess = null;

    consola.info(`Desktop recording saved: ${this.outputPath}`);
    return this.outputPath;
  }
}
