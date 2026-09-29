import type { NodeProps } from '@xyflow/react';
import { FileCode } from 'lucide-react';
import StepNodeShell from '../StepNodeShell';
import { firstScriptLine, type StepCanvasNode } from '../types';

export default function ScriptNode({ data, selected }: NodeProps<StepCanvasNode>) {
  return (
    <StepNodeShell
      data={data}
      selected={selected}
      icon={<FileCode size={16} />}
      preview={firstScriptLine(data)}
    />
  );
}
