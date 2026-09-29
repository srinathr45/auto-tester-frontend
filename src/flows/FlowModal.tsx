import { useState } from 'react';
import { X } from 'lucide-react';

interface FlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateFlow: (data: { projectId: number; name: string; description?: string }) => void;
  selectedProjectId: number | undefined;
}

export default function FlowModal({ isOpen, onClose, onCreateFlow, selectedProjectId }: FlowModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !selectedProjectId) return;
    onCreateFlow({
      projectId: selectedProjectId,
      name: name.trim(),
      description: description.trim() || undefined,
    });
    setName('');
    setDescription('');
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Create Test Flow</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="field-label">Flow Name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="field-label">Description</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Create Flow
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
