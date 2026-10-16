import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// 현재 대화의 도구 목록 갱신 없이 등록한 MCP 서버의 실제 응답을 검증한다.
const client = new Client({ name: 'dalbearXterm-analysis', version: '0.1.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('.tools/rea/node_modules/rea-agents/scripts/rea.mjs'), 'mcp'], stderr: 'inherit' });
await mkdir('research', { recursive: true });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const target = 'C:\\Program Files (x86)\\Mobatek\\MobaXterm\\MobaXterm.exe';
  const tool = tools.tools.find(tool => tool.name === 'inspect_pe_resources');
  if (!tool) throw new Error('PE 리소스 분석 도구가 노출되지 않았습니다.');
  await writeFile('research/rea-tools.json', JSON.stringify({ count: tools.tools.length, selected: tool }, null, 2));
  const result = await client.callTool({ name: tool.name, arguments: { path: target } });
  await writeFile('research/mobaxterm-mcp-evidence.json', JSON.stringify(result, null, 2));
  if (result.isError) throw new Error('REA 분석 오류: research/mobaxterm-mcp-evidence.json 확인');
  console.log(JSON.stringify({ connected: true, toolCount: tools.tools.length, tool: tool.name, evidenceFile: 'research/mobaxterm-mcp-evidence.json' }));
} finally {
  await client.close();
}
