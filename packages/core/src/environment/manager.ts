import { execa } from "execa";
import consola from "consola";
import type { EnvironmentConfig } from "../types/config";

export interface Environment {
  mode: "docker" | "native";
  containerId?: string;
  cleanup: () => Promise<void>;
}

export async function setupEnvironment(
  config: EnvironmentConfig,
  cwd: string
): Promise<Environment> {
  if (config.mode === "docker") {
    return setupDocker(config, cwd);
  }
  return setupNative();
}

async function setupDocker(
  config: EnvironmentConfig,
  cwd: string
): Promise<Environment> {
  consola.info("Starting Docker environment...");

  const volumes = [
    `-v`, `${cwd}:/workspace`,
    ...config.docker.volumes.flatMap((v) => ["-v", v]),
  ];

  const result = await execa(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      ...volumes,
      "-w", "/workspace",
      config.docker.image,
      "tail", "-f", "/dev/null",
    ],
    { cwd }
  );

  const containerId = result.stdout.trim();
  consola.info(`Docker container started: ${containerId.slice(0, 12)}`);

  return {
    mode: "docker",
    containerId,
    cleanup: async () => {
      consola.info("Stopping Docker container...");
      try {
        await execa("docker", ["stop", containerId]);
      } catch {
        // Container might already be stopped
      }
    },
  };
}

async function setupNative(): Promise<Environment> {
  consola.info("Using native environment");
  return {
    mode: "native",
    cleanup: async () => {
      // Nothing to clean up in native mode
    },
  };
}
