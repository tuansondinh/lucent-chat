import createSlashCommand from "./create-slash-command.js";
import createExtension from "./create-extension.js";
import auditCommand from "./audit.js";
import clearCommand from "./clear.js";
export default function slashCommands(pi) {
    createSlashCommand(pi);
    createExtension(pi);
    auditCommand(pi);
    clearCommand(pi);
}
