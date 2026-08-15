module.exports = (() => {
  const fs = require("fs");
  const path = require("path");

  const parseEnvFile = (filePath) => {
    const env = {};
    if (!fs.existsSync(filePath)) {
      return env;
    }

    for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }

    return env;
  };

  const fileEnv = parseEnvFile(path.join(__dirname, ".env"));
  const appEnvName = String(
    fileEnv.APP_ENV || process.env.APP_ENV || "production",
  )
    .trim()
    .toLowerCase();

  const processName =
    appEnvName === "staging" ? "staging-advanced-uploader" : "advanced-uploader";

  const port = String(fileEnv.PORT || process.env.PORT || "3000");
  const nodeEnv = String(fileEnv.NODE_ENV || "production");

  return {
    apps: [
      {
        name: processName,
        cwd: ".",
        script: "dist/server.js",
        instances: 1,
        exec_mode: "fork",
        autorestart: true,
        max_memory_restart: "512M",
        time: true,
        merge_logs: true,
        out_file: path.join(__dirname, "logs", "pm2-out.log"),
        error_file: path.join(__dirname, "logs", "pm2-error.log"),
        env: {
          NODE_ENV: nodeEnv,
          APP_ENV: appEnvName,
          PORT: port,
        },
      },
    ],
  };
})();
