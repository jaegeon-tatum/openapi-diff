import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";

dotenv.config();
const __dirname = path.resolve();

const SLACK_CHANNEL_URL = process.env.SLACK_CHANNEL_URL;
// 서버의 swagger.init.js 경로
const SWAGGER_INIT_JS_URL = process.env.SWAGGER_INIT_JS_URL;

const RESOURCE_PATH = path.join(__dirname, "specs");
// 마지막으로 확인한 데이터
const LOCAL_OPEN_API_JSON = "local-api.json";
const LOCAL_OPEN_API_JSON_PATH = path.join(RESOURCE_PATH, LOCAL_OPEN_API_JSON);
// 서버의 최신 데이터
const SERVER_OPEN_API_JSON = "server-api.json";
const SERVER_OPEN_API_JSON_PATH = path.join(RESOURCE_PATH, SERVER_OPEN_API_JSON);

function fetchSwaggerInitJS() {
  return new Promise((resolve, reject) =>
    fetch(SWAGGER_INIT_JS_URL)
      .then((res) => res.text())
      .then((jsCode) => resolve(jsCode))
      .catch((error) => reject(`파일을 가져오는 중 오류 발생: ${error}`))
  );
}

async function parseOpenAPIJSONFromInitJS(initJS) {
  const option = initJS.match(/let options = (\{[^]+?\});/)[0];
  const openAPIJSON = JSON.parse(option.toString().replace("let options = ", "").replace(";", ""));
  return openAPIJSON.swaggerDoc;
}

function writeOpenAPIJSON(path, contents) {
  fs.writeFileSync(path, JSON.stringify(contents));
}

function overwriteCurrentJSON() {
  fs.renameSync(SERVER_OPEN_API_JSON_PATH, LOCAL_OPEN_API_JSON_PATH)
}

function postSlack(content) {
  fetch(SLACK_CHANNEL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      text: content,
    }),
  })
    .then((res) => res.text())
    .then((res) => console.log(res));
}

function runDiff() {
  const process = spawn("docker", [
    "run",
    "-v",
    `${RESOURCE_PATH}:/specs`,
    "-t",
    "--rm",
    "openapitools/openapi-diff:latest",
    `/specs/${LOCAL_OPEN_API_JSON}`,
    `/specs/${SERVER_OPEN_API_JSON}`,
  ]);
  process.stdout.on("data", (buf) => {
    overwriteCurrentJSON()
    const data = buf.toString();
    if (data.startsWith("No differences")) {
      return;
    }
    postSlack(
      data
        .replace(
          "                          API CHANGE LOG",
          "             🚨 Frontend Bot이 API 변경을 탐지했습니다! 🚨"
        )
        .replaceAll("=", "-")
        .replaceAll("-- ", "  ")
        .replaceAll(" --", "")
    );
  });
}

async function main() {
  const initJS = await fetchSwaggerInitJS();
  const serverOpenAPIJSON = await parseOpenAPIJSONFromInitJS(initJS);

  if (!fs.existsSync(RESOURCE_PATH)) {
    fs.mkdirSync(RESOURCE_PATH);
  }

  writeOpenAPIJSON(SERVER_OPEN_API_JSON_PATH, serverOpenAPIJSON);

  if (!fs.existsSync(LOCAL_OPEN_API_JSON_PATH)) {
    writeOpenAPIJSON(LOCAL_OPEN_API_JSON_PATH, serverOpenAPIJSON);
  }

  runDiff();
}
main();
