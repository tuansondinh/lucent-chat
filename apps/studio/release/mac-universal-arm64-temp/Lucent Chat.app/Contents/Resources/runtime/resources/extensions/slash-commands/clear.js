export default function clearCommand(pi) {
    pi.registerCommand("clear", {
        description: "Alias for /new — start a new session",
        async handler(_args, ctx) {
            await ctx.newSession();
        },
    });
}
