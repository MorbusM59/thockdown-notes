import React, { useRef } from 'react';
import './Utility.scss';

interface UtilityProps {
  onActionComplete?: () => void;
  onExportPdf?: (chooseFolder?: boolean) => Promise<void>;
  
  autoSaveEnabled?: boolean;
  onToggleAutoSave?: () => void;

  hasSelectedNote?: boolean;

  logBase?: number;
  onLogBaseChange?: (base: number) => void;
}

export const Utility: React.FC<UtilityProps> = ({
  onActionComplete,
  onExportPdf,
  autoSaveEnabled = true,
  onToggleAutoSave,
  hasSelectedNote = false,
  logBase = 10,
  onLogBaseChange,
}) => {
  const [isEditingBase, setIsEditingBase] = React.useState(false);
  const [baseInput, setBaseInput] = React.useState(logBase.toString());
  const historyGroupRef = useRef<HTMLDivElement>(null);

  const handleSync = async () => {
    try {
      await window.electronAPI.triggerSync();
      onActionComplete?.();
    } catch (err) {
      console.warn('triggerSync failed', err);
    }
  };

  const handleImport = async () => {
    try {
      await window.electronAPI.importFolder();
      onActionComplete?.();
    } catch (err) {
      console.warn('importFolder failed', err);
    }
  };

  const handleClean = async () => {
    try {
      await window.electronAPI.purgeTrash();
      onActionComplete?.();
    } catch (err) {
      console.warn('purgeTrash failed', err);
    }
  };

  const handleExportClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    try {
      if (onExportPdf) {
        await onExportPdf(event.shiftKey);
      }
    } catch (err) {
      console.warn('exportPdf failed', err);
    }
  };

  let historyButtonTitle = autoSaveEnabled ? "Auto-Save: ON" : "Auto-Save: OFF";

  return (
    <div className="utility-panel">
      <button
        className="utility-btn"
        type="button"
        onClick={handleSync}
        title="Sync data folder"
        aria-label="Sync data folder"
      >
        <i className="fa-solid fa-sync" aria-hidden="true" />
      </button>
      <button
        className="utility-btn"
        type="button"
        onClick={handleImport}
        title="Import from folder"
        aria-label="Import from folder"
      >
        <i className="fa-solid fa-file-import" aria-hidden="true" />
      </button>
      <button
        className="utility-btn"
        type="button"
        onClick={handleExportClick}
        title="Export to PDF. Shift-click to choose folder"
        aria-label="Export to PDF"
      >
        <i className="fa-solid fa-file-pdf" aria-hidden="true" />
      </button>
      <button
        className="utility-btn utility-btn--danger"
        type="button"
        onClick={handleClean}
        title="Permanently purge Trash"
        aria-label="Permanently purge Trash"
      >
        <i className="fa-solid fa-trash-can" aria-hidden="true" />
      </button>

      <div
        ref={historyGroupRef}
        className="utility-history-group"
      >
        {isEditingBase ? (
          <input
            className="utility-btn utility-btn--history"
            style={{ width: '40px', padding: '0 4px', textAlign: 'center', background: 'var(--markdown-editor-background)', color: 'var(--markdown-editor-foreground)', border: 'none' }}
            autoFocus
            value={baseInput}
            onChange={e => setBaseInput(e.target.value)}
            onBlur={() => {
              setIsEditingBase(false);
              setBaseInput(logBase.toString());
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const parsed = parseFloat(baseInput);
                if (!isNaN(parsed) && parsed > 0 && parsed !== 1) {
                  onLogBaseChange?.(parsed);
                } else {
                  setBaseInput(logBase.toString());
                }
                setIsEditingBase(false);
              } else if (e.key === 'Escape') {
                setIsEditingBase(false);
                setBaseInput(logBase.toString());
              }
            }}
          />
        ) : (
          <button
            className={`utility-btn utility-btn--history ${!autoSaveEnabled ? 'utility-btn--armed' : ''}`}
            type="button"
            onClick={onToggleAutoSave}
            onContextMenu={e => {
              e.preventDefault();
              setIsEditingBase(true);
              setBaseInput(logBase.toString());
            }}
            title={historyButtonTitle}
            aria-label="Toggle Auto-Save"
            disabled={!hasSelectedNote}
          >
            <i className="fa-solid fa-clock-rotate-left" style={{ opacity: autoSaveEnabled ? 1 : 0.5 }} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="utility-btn utility-btn--placeholder">
        <span className="utility-icon utility-icon--empty-set" />
      </div>
    </div>
  );
};

export default Utility;
