import { Plus } from 'lucide-react';
import type { FlowEdge, FlowNode, Step } from '../shared/types';
import { orderFlowNodes } from '../shared/orderNodes';
import StepList from './steps/StepList';
import StepSearch from './steps/StepSearch';

interface SidebarProps {
  projectId: number | undefined;
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  highlightedNodeId?: string | null;
  onSelectNode: (nodeId: string) => void;
  onAddStep: () => void;
  onSearchSelectStep: (step: Step) => void;
}

/**
 * Left editor panel: project step search + ordered step list + add-step.
 * Flow switching lives on the toolbar / dashboard (not here).
 */
export default function Sidebar({
  projectId,
  nodes,
  edges,
  selectedNodeId,
  highlightedNodeId,
  onSelectNode,
  onAddStep,
  onSearchSelectStep,
}: SidebarProps) {
  const ordered = orderFlowNodes(nodes, edges);

  return (
    <aside
      className="glass-panel"
      style={{
        width: 280,
        flexShrink: 0,
        margin: '12px 0 12px 12px',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        overflow: 'hidden',
        zIndex: 5,
      }}
    >
      <StepSearch projectId={projectId} onSelectStep={onSearchSelectStep} />

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn-secondary" style={{ padding: '0.35rem 0.7rem', width: '100%' }} onClick={onAddStep}>
          <Plus size={14} />
          <span>Add step</span>
        </button>
      </div>

      <StepList
        nodes={ordered}
        selectedNodeId={selectedNodeId}
        highlightedNodeId={highlightedNodeId}
        onSelectNode={onSelectNode}
      />
    </aside>
  );
}
