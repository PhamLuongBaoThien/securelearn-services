const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const protoDir = path.join(rootDir, 'src', 'grpc', 'protos');
const outputDir = path.join(rootDir, 'src', 'grpc', 'generated');
const protoFile = path.join(protoDir, 'securelearn.proto');

const binDir = path.join(rootDir, 'node_modules', '.bin');
const tsProtoPlugin = path.join(
  binDir,
  process.platform === 'win32' ? 'protoc-gen-ts_proto.cmd' : 'protoc-gen-ts_proto',
);
const protocBin = process.platform === 'win32'
  ? path.join(rootDir, 'node_modules', 'grpc-tools', 'bin', 'protoc.exe')
  : path.join(binDir, 'grpc_tools_node_protoc');

fs.mkdirSync(outputDir, { recursive: true });

const args = [
  `--plugin=protoc-gen-ts_proto=${tsProtoPlugin}`,
  `--ts_proto_out=${outputDir}`,
  '--ts_proto_opt=outputServices=grpc-js,env=node,esModuleInterop=true,useExactTypes=false',
  protoFile,
  '-I',
  protoDir,
];

execFileSync(protocBin, args, {
  cwd: rootDir,
  stdio: 'inherit',
});
