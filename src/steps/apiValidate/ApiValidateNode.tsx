import type { NodeProps } from '@xyflow/react';
import { Globe } from 'lucide-react';
import StepNodeShell from '../StepNodeShell';
import { firstScriptLine, type StepCanvasNode } from '../types';

export default function ApiValidateNode({ data, selected }: NodeProps<StepCanvasNode>) {
  return (
    <StepNodeShell
      data={data}
      selected={selected}
      icon={<Globe size={16} />}
      preview={firstScriptLine(data)}
    />
  );
}
