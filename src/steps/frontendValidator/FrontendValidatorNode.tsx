import type { NodeProps } from '@xyflow/react';
import { ShieldCheck } from 'lucide-react';
import StepNodeShell from '../StepNodeShell';
import { firstScriptLine, type StepCanvasNode } from '../types';

export default function FrontendValidatorNode({ data, selected }: NodeProps<StepCanvasNode>) {
  return (
    <StepNodeShell
      data={data}
      selected={selected}
      icon={<ShieldCheck size={16} />}
      preview={firstScriptLine(data, 'Configure validation rules')}
    />
  );
}
