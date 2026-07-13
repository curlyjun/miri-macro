"use strict";

const { main } = require("./monitor");
const path = require("path");
const { RuntimeState } = require("./lib/runtime-state");
const { reportFatal } = require("./lib/run-alerts");
const { nowKST, sendTelegram } = require("./lib/common");

main({ dryRun: true }).catch(async (error) => {
  console.error("치명적 오류:", error);
  await reportFatal({
    scope: "observe",
    error,
    state: new RuntimeState({
      statePath: path.join(__dirname, "runtime", "state.json"),
    }),
    sendTelegram,
    executedAt: nowKST(),
  });
  process.exitCode = 1;
});
