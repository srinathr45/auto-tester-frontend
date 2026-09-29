import type { Node } from '@xyflow/react';
import type { FlowEdge, FlowNode, Project, StepData } from '../shared/types';

export type StepCanvasData = StepData & {
  __highlighted?: boolean;
  __flowDir?: 'vertical' | 'horizontal';
};

export type StepCanvasNode = Node<StepCanvasData, 'customStep'>;

export interface RepeatFromOption {
  id: string;
  label: string;
}

/** Inspector fields that a step kind owns (goal, wait, loop, …). */
export interface KindFieldsProps {
  data: StepData;
  onChange: (patch: Partial<StepData>) => void;
  aiFillContext?: {
    project: Project | null;
    nodes: FlowNode[];
    edges: FlowEdge[];
    selectedNodeId: string;
    onEnsurePreview?: () => void;
  };
  fieldCaptureContext?: {
    project: Project | null;
    nodes: FlowNode[];
    edges: FlowEdge[];
    selectedNodeId: string;
    onEnsurePreview?: () => void;
  };
}

export interface LoopFieldsProps extends KindFieldsProps {
  repeatFromOptions?: RepeatFromOption[];
  repeatFromId?: string | null;
  onRepeatFromChange?: (targetNodeId: string | null) => void;
}

/** First non-empty script line for canvas preview; fallback when the step has no script. */
export function firstScriptLine(data: StepData, empty = 'Empty script'): string {
  return (data.scriptText || '').trim().split('\n')[0] || empty;
}
