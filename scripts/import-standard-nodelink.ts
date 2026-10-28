/**
 * ITS 표준 노드·링크 데이터 → PostGIS 임포트.
 *
 * 원본 SHP/DBF는 Git에 넣지 않습니다. 이 스크립트가 ITRF2000 Central Belt 60
 * 좌표를 EPSG:5179로 변환하면서 psql COPY로 Neon의 road_* 테이블을 교체합니다.
 * 검색 런타임은 이 테이블을 읽기만 하므로, 임포트는 배포 전 또는 데이터 갱신 때
 * 운영 환경에서 한 번 실행합니다.
 *
 * 사용법:
 *   pnpm data:import-nodelink -- /path/to/[2026-10-14]NODELINKDATA
 *   pnpm data:import-nodelink -- --dry-run --limit 3 /path/to/[2026-10-14]NODELINKDATA
 *
 * --limit은 dry-run에서만 허용합니다. 실제 DB에 일부만 적재하는 사고를 막기 위한
 * 제한입니다. DATABASE_URL은 dry-run이 아닐 때만 필요합니다.
 */

import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import proj4 from "proj4";

const SOURCE_CRS =
  "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs";
const TARGET_CRS =
  "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";

const sourcePath = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;

if (limit != null && (!Number.isInteger(limit) || limit < 1)) {
  throw new Error("--limit은 1 이상의 정수여야 합니다.");
}
if (limit != null && !dryRun) {
  throw new Error("--limit은 --dry-run과 함께만 사용할 수 있습니다.");
}

const sourceDir = path.resolve(sourcePath ?? path.join(process.cwd(), "data", "standard-nodelink"));

type DbfField = { name: string; length: number };
type DbfRow = Record<string, string>;
type Point = [number, number];
type Shape = { shapeType: number; points: Point[] };

type Counts = { nodeCount: number; linkCount: number; turnCount: number };
const DELETED_ROW = "__deleted__";

function requiredFile(name: string): string {
  const file = path.join(sourceDir, name);
  if (!existsSync(file)) throw new Error(`파일을 찾을 수 없습니다: ${file}`);
  return file;
}

function decodeDbf(buffer: Buffer): string {
  return new TextDecoder("euc-kr").decode(buffer);
}

async function* readDbfRows(filePath: string): AsyncGenerator<DbfRow> {
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(32);
    await handle.read(header, 0, header.length, 0);
    const recordCount = header.readUInt32LE(4);
    const headerLength = header.readUInt16LE(8);
    const recordLength = header.readUInt16LE(10);
    const fieldHeader = Buffer.alloc(headerLength - 32);
    await handle.read(fieldHeader, 0, fieldHeader.length, 32);

    const fields: DbfField[] = [];
    for (let offset = 0; offset + 32 <= fieldHeader.length; offset += 32) {
      if (fieldHeader[offset] === 0x0d) break;
      const nameEnd = fieldHeader.subarray(offset, offset + 11).indexOf(0);
      const name = decodeDbf(fieldHeader.subarray(offset, offset + (nameEnd < 0 ? 11 : nameEnd))).trim();
      if (name) fields.push({ name, length: fieldHeader[offset + 16] });
    }

    const stream = createReadStream(filePath, { start: headerLength, highWaterMark: 1024 * 1024 });
    let pending = Buffer.alloc(0);
    let yielded = 0;
    for await (const chunk of stream) {
      pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
      while (pending.length >= recordLength && yielded < recordCount) {
        const record = pending.subarray(0, recordLength);
        pending = pending.subarray(recordLength);
        yielded += 1;
        if (record[0] === 0x2a) {
          // SHP와 DBF의 레코드 순서를 유지한 채 호출부에서 함께 건너뜁니다.
          yield { [DELETED_ROW]: "1" };
          continue;
        }

        const row: DbfRow = {};
        let offset = 1;
        for (const field of fields) {
          row[field.name] = decodeDbf(record.subarray(offset, offset + field.length)).trim();
          offset += field.length;
        }
        yield row;
      }
      if (yielded >= recordCount) break;
    }
  } finally {
    await handle.close();
  }
}

async function* readShapeRecords(filePath: string): AsyncGenerator<Shape> {
  const stream = createReadStream(filePath, { start: 100, highWaterMark: 1024 * 1024 });
  let pending = Buffer.alloc(0);
  for await (const chunk of stream) {
    pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
    while (pending.length >= 8) {
      const contentLength = pending.readUInt32BE(4) * 2;
      if (pending.length < 8 + contentLength) break;
      const content = pending.subarray(8, 8 + contentLength);
      pending = pending.subarray(8 + contentLength);
      const shapeType = content.readInt32LE(0);
      if (shapeType === 0) {
        yield { shapeType, points: [] };
        continue;
      }
      if (shapeType === 1) {
        yield { shapeType, points: [[content.readDoubleLE(4), content.readDoubleLE(12)]] };
        continue;
      }
      if (shapeType !== 3) throw new Error(`지원하지 않는 SHP 타입 ${shapeType}: ${filePath}`);

      const partCount = content.readInt32LE(36);
      const pointCount = content.readInt32LE(40);
      const pointsOffset = 44 + partCount * 4;
      const points: Point[] = [];
      for (let i = 0; i < pointCount; i += 1) {
        const offset = pointsOffset + i * 16;
        points.push([content.readDoubleLE(offset), content.readDoubleLE(offset + 8)]);
      }
      yield { shapeType, points };
    }
  }
}

function value(row: DbfRow, name: string): string {
  const result = row[name]?.trim();
  if (!result) throw new Error(`DBF 필수 필드 ${name}가 비어 있습니다.`);
  return result;
}

function optional(row: DbfRow, name: string): string | null {
  const result = row[name]?.trim();
  return result ? result : null;
}

function integer(row: DbfRow, name: string): number | null {
  const result = optional(row, name);
  if (result == null) return null;
  const parsed = Number.parseInt(result, 10);
  if (!Number.isFinite(parsed)) throw new Error(`DBF 정수 필드 ${name} 파싱 실패: ${result}`);
  return parsed;
}

function real(row: DbfRow, name: string): number | null {
  const result = optional(row, name);
  if (result == null) return null;
  const parsed = Number.parseFloat(result);
  if (!Number.isFinite(parsed)) throw new Error(`DBF 실수 필드 ${name} 파싱 실패: ${result}`);
  return parsed;
}

function date(row: DbfRow, name: string): string | null {
  const result = optional(row, name);
  if (result == null) return null;
  if (!/^\d{8}$/.test(result)) throw new Error(`DBF 날짜 필드 ${name} 파싱 실패: ${result}`);
  return `${result.slice(0, 4)}-${result.slice(4, 6)}-${result.slice(6, 8)}`;
}

function transformed([x, y]: Point): Point {
  const [targetX, targetY] = proj4(SOURCE_CRS, TARGET_CRS, [x, y]);
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    throw new Error(`좌표 변환 실패: ${x}, ${y}`);
  }
  return [targetX, targetY];
}

function numberText(number: number): string {
  return number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function geometry(shape: Shape, expected: "POINT" | "LINESTRING"): string {
  if (expected === "POINT" && shape.shapeType === 1 && shape.points.length === 1) {
    const [x, y] = transformed(shape.points[0]);
    return `SRID=5179;POINT(${numberText(x)} ${numberText(y)})`;
  }
  if (expected === "LINESTRING" && shape.shapeType === 3 && shape.points.length >= 2) {
    const points = shape.points.map(transformed).map(([x, y]) => `${numberText(x)} ${numberText(y)}`);
    return `SRID=5179;LINESTRING(${points.join(",")})`;
  }
  throw new Error(`DBF/SHP geometry 타입 또는 점 수가 맞지 않습니다: ${expected}`);
}

function copyCell(input: string | number | null | undefined): string {
  if (input == null || input === "") return "\\N";
  return String(input).replace(/\\/g, "\\\\").replace(/[\t\r\n]/g, " ");
}

function copyLine(values: Array<string | number | null | undefined>): string {
  return `${values.map(copyCell).join("\t")}\n`;
}

async function* nodeRows(counts: Counts, maxRows?: number): AsyncGenerator<string> {
  const dbf = readDbfRows(requiredFile("MOCT_NODE.dbf"))[Symbol.asyncIterator]();
  const shp = readShapeRecords(requiredFile("MOCT_NODE.shp"))[Symbol.asyncIterator]();
  while (maxRows == null || counts.nodeCount < maxRows) {
    const [dbfNext, shpNext] = await Promise.all([dbf.next(), shp.next()]);
    if (dbfNext.done || shpNext.done) break;
    const row = dbfNext.value;
    const shape = shpNext.value;
    if (row[DELETED_ROW]) continue;
    counts.nodeCount += 1;
    yield copyLine([
      value(row, "NODE_ID"),
      value(row, "NODE_TYPE"),
      optional(row, "NODE_NAME"),
      optional(row, "TURN_P"),
      date(row, "UPDATEDATE"),
      geometry(shape, "POINT"),
    ]);
  }
}

async function* linkRows(counts: Counts, maxRows?: number): AsyncGenerator<string> {
  const dbf = readDbfRows(requiredFile("MOCT_LINK.dbf"))[Symbol.asyncIterator]();
  const shp = readShapeRecords(requiredFile("MOCT_LINK.shp"))[Symbol.asyncIterator]();
  while (maxRows == null || counts.linkCount < maxRows) {
    const [dbfNext, shpNext] = await Promise.all([dbf.next(), shp.next()]);
    if (dbfNext.done || shpNext.done) break;
    const row = dbfNext.value;
    const shape = shpNext.value;
    if (row[DELETED_ROW]) continue;
    counts.linkCount += 1;
    yield copyLine([
      value(row, "LINK_ID"),
      value(row, "F_NODE"),
      value(row, "T_NODE"),
      integer(row, "LANES"),
      optional(row, "ROAD_RANK"),
      optional(row, "ROAD_TYPE"),
      optional(row, "ROAD_NO"),
      optional(row, "ROAD_NAME"),
      optional(row, "ROAD_USE"),
      optional(row, "MULTI_LINK"),
      optional(row, "CONNECT"),
      integer(row, "MAX_SPD"),
      optional(row, "REST_VEH"),
      integer(row, "REST_W"),
      integer(row, "REST_H"),
      optional(row, "C-ITS"),
      real(row, "LENGTH"),
      date(row, "UPDATEDATE"),
      geometry(shape, "LINESTRING"),
    ]);
  }
}

async function* turnRows(counts: Counts, maxRows?: number): AsyncGenerator<string> {
  for await (const row of readDbfRows(requiredFile("TURNINFO.dbf"))) {
    if (row[DELETED_ROW]) continue;
    if (maxRows != null && counts.turnCount >= maxRows) break;
    counts.turnCount += 1;
    yield copyLine([
      value(row, "NODE_ID"),
      integer(row, "TURN_ID"),
      value(row, "ST_LINK"),
      value(row, "ED_LINK"),
      optional(row, "TURN_TYPE"),
      optional(row, "TURN_OPER"),
      optional(row, "REMARK"),
    ]);
  }
}

async function writeWithBackpressure(stream: NodeJS.WritableStream, text: string): Promise<void> {
  if (stream.write(text)) return;
  await once(stream, "drain");
}

async function copyTable(
  stdin: NodeJS.WritableStream,
  table: string,
  columns: string,
  rows: AsyncIterable<string>,
): Promise<void> {
  await writeWithBackpressure(stdin, `COPY ${table} (${columns}) FROM STDIN WITH (FORMAT text);\n`);
  for await (const row of rows) await writeWithBackpressure(stdin, row);
  await writeWithBackpressure(stdin, "\\.\n");
}

function sourceDate(): string {
  const match = path.basename(sourceDir).match(/(\d{4}-\d{2}-\d{2})/);
  if (!match) throw new Error(`원본 폴더명에서 기준일자를 찾을 수 없습니다: ${sourceDir}`);
  return match[1];
}

async function run(): Promise<void> {
  if (!existsSync(sourceDir)) {
    throw new Error(`원본 폴더를 찾을 수 없습니다: ${sourceDir}`);
  }
  if (sourceDir.toLowerCase().endsWith(".zip")) {
    throw new Error("ZIP은 먼저 별도 폴더에 압축 해제한 뒤 그 폴더를 지정하십시오. 원본 ZIP은 Git에 넣지 않습니다.");
  }
  requiredFile("MOCT_NODE.dbf");
  requiredFile("MOCT_NODE.shp");
  requiredFile("MOCT_LINK.dbf");
  requiredFile("MOCT_LINK.shp");
  requiredFile("TURNINFO.dbf");

  const counts: Counts = { nodeCount: 0, linkCount: 0, turnCount: 0 };
  const maxRows = limit;
  if (dryRun) {
    const samples: string[] = [];
    for await (const row of nodeRows(counts, maxRows)) if (samples.length < 2) samples.push(row);
    for await (const row of linkRows(counts, maxRows)) if (samples.length < 4) samples.push(row);
    for await (const row of turnRows(counts, maxRows)) if (samples.length < 6) samples.push(row);
    console.log(JSON.stringify({ sourceDir, sourceDate: sourceDate(), counts, samples }, null, 2));
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL 환경변수가 필요합니다.");

  const psql = spawn(
    "psql",
    ["--no-psqlrc", "--quiet", "--set", "ON_ERROR_STOP=1", "--dbname", databaseUrl],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  psql.once("error", (error) => psql.stdin.destroy(error));
  await writeWithBackpressure(psql.stdin, "BEGIN;\nTRUNCATE TABLE road_turn, road_link, road_node;\n");
  await copyTable(
    psql.stdin,
    "road_node",
    "node_id,node_type,node_name,turn_p,updated_date,geometry",
    nodeRows(counts),
  );
  await copyTable(
    psql.stdin,
    "road_link",
    "link_id,from_node,to_node,lanes,road_rank,road_type,road_no,road_name,road_use,multi_link,connect,max_speed,rest_veh,rest_w,rest_h,c_its,length_m,updated_date,geometry",
    linkRows(counts),
  );
  await copyTable(
    psql.stdin,
    "road_turn",
    "node_id,turn_id,start_link,end_link,turn_type,turn_oper,remark",
    turnRows(counts),
  );
  const escapedSource = path.basename(sourceDir).replace(/'/g, "''");
  await writeWithBackpressure(
    psql.stdin,
    `INSERT INTO road_network_import (source_date,node_count,link_count,turn_count,source_file) VALUES ('${sourceDate()}',${counts.nodeCount},${counts.linkCount},${counts.turnCount},'${escapedSource}');\nCOMMIT;\n`,
  );
  psql.stdin.end();
  const [exitCode] = (await once(psql, "close")) as [number];
  if (exitCode !== 0) throw new Error(`psql 임포트 실패 (exit ${exitCode})`);
  console.log(JSON.stringify({ sourceDir, sourceDate: sourceDate(), counts }, null, 2));
}

run().catch((error: unknown) => {
  console.error("표준 노드·링크 임포트 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
