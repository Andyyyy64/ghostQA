import { Command } from "commander";
import { initCommand } from "./commands/init";
import { runCommand } from "./commands/run";
import { viewCommand } from "./commands/view";
import { doctorCommand } from "./commands/doctor";
import { validateCommand } from "./commands/validate";
import { recordCommand } from "./commands/record";
import { estimateCommand } from "./commands/estimate";
import { baselineCommand } from "./commands/baseline";
import { replayCommand } from "./commands/replay";

const program = new Command();

program
  .name("ghostqa")
  .description(
    "AI-powered browser testing that finds bugs in your code changes"
  )
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(runCommand);
program.addCommand(viewCommand);
program.addCommand(doctorCommand);
program.addCommand(validateCommand);
program.addCommand(recordCommand);
program.addCommand(estimateCommand);
program.addCommand(baselineCommand);
program.addCommand(replayCommand);

program.parse();
