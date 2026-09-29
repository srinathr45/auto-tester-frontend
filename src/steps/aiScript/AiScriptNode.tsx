import type { NodeProps } from '@xyflow/react';
import { Wand2 } from 'lucide-react';
import StepNodeShell from '../StepNodeShell';
import { firstScriptLine, type StepCanvasNode } from '../types';

export default function AiScriptNode({ data, selected }: NodeProps<StepCanvasNode>) {
  return (
    <StepNodeShell
      data={data}
      selected={selected}
      icon={<Wand2 size={16} />}
      preview={firstScriptLine(data)}
    />
  );
}
