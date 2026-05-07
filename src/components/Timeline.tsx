import React, { useState } from 'react';
import { NoteSnapshot } from '../shared/types';
import './Timeline.scss';

interface TimelineProps {
  snapshots: NoteSnapshot[];
  timeMachineIndex: number;
  logBase?: number;
  onNavigate: (index: number) => void;
  onDeleteSnapshot: (snapshotId: number) => void;
  onManualSnapshot: () => void;
  
  charWidth?: number;
  gridWidth?: number;
}

export const Timeline: React.FC<TimelineProps> = ({
  snapshots,
  timeMachineIndex,
  logBase = 10,
  onNavigate,
  onDeleteSnapshot,
  onManualSnapshot,
  charWidth,
  gridWidth
}) => {
  const [armedSnapshotId, setArmedSnapshotId] = useState<number | null>(null);
  const [openFlyoutCol, setOpenFlyoutCol] = useState<number | null>(null);

  // Snapshots are sorted DESC by timestamp (0 is newest).
  // However, we may want to render present at the right, oldest at the left.
  
  const presentDate = React.useMemo(() => Date.now(), [snapshots]);
  const oldestDate = new Date(snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : presentDate).getTime();
  const presentDateNum = presentDate;
  const totalDuration = Math.max(1000, presentDateNum - oldestDate); // prevent div by zero

  const numCols = charWidth && gridWidth ? Math.floor(gridWidth / charWidth) : 50;

    const ONE_DAY = 24 * 60 * 60 * 1000;
    const ONE_YEAR = 365 * ONE_DAY;

    const calculateCol = (timestamp: string) => {
      const age = presentDate - new Date(timestamp).getTime();
      if (age <= 0) return numCols - 1; // rightmost col
      
      const numSnapshotCols = Math.max(1, numCols - 2); // Exclude present box and gap
      
      const documentAge = presentDateNum - oldestDate;
      const timelineSpan = Math.max(ONE_DAY, Math.min(ONE_YEAR, documentAge));

      if (age >= timelineSpan) return 0;
      
      const b = Math.max(1, logBase);
      const logAge = Math.log(age / b + 1);
      const logSpan = Math.log(timelineSpan / b + 1);
      const perc = (logSpan - logAge) / logSpan;
      
      const rawCol = Math.floor(perc * numSnapshotCols);
      return Math.max(0, Math.min(numSnapshotCols - 1, rawCol));
    };


  const handleBoxLeftClick = (e: React.MouseEvent, index: number, isMulti: boolean, colIndex: number) => {
    if (isMulti) {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setOpenFlyoutCol(openFlyoutCol === colIndex ? null : colIndex);
      return;
    }
    onNavigate(index);
    setArmedSnapshotId(null);
    setOpenFlyoutCol(null);
  };

  const handleFlyoutItemClick = (index: number) => {
    onNavigate(index);
    setArmedSnapshotId(null);
    setOpenFlyoutCol(null);
  };

  React.useEffect(() => {
    if (openFlyoutCol !== null) {
      const globalClick = () => setOpenFlyoutCol(null);
      document.addEventListener('click', globalClick);
      return () => document.removeEventListener('click', globalClick);
    }
  }, [openFlyoutCol]);

  const handleBoxRightClick = (e: React.MouseEvent, index: number, snap: NoteSnapshot) => {
    e.preventDefault();
    if (armedSnapshotId !== snap.id) {
      // 1st right click: Arm (color red)
      setArmedSnapshotId(snap.id);
    } else {
      // 2nd right click: Delete
      onDeleteSnapshot(snap.id);
      setArmedSnapshotId(null);
    }
  };

  const handlePresentLeftClick = () => {
    if (timeMachineIndex === -1) {
      onManualSnapshot();
    } else {
      onNavigate(-1);
    }
    setArmedSnapshotId(null);
    setOpenFlyoutCol(null);
  };

  // We should cluster snapshots that share the same horizontal coordinate to avoid exact overlap.
  // A box is maybe 16px wide. We can calculate pixel positions roughly if we know the width, but using % and relative positioning with a Flex or absolute layout is better.
  // We cluster snapshots if they naturally map to the exact same column index!
  const clusters: { [key: number]: { index: number, snapshot: NoteSnapshot }[] } = {};

  snapshots.forEach((snap, idx) => {
    const col = calculateCol(snap.timestamp);
    if (!clusters[col]) clusters[col] = [];
    clusters[col].push({ index: idx, snapshot: snap });
  });

  return (
    <div className="timeline-container" style={{ height: charWidth ? `${charWidth}px` : '14px' }}>
      <div className="timeline-track" style={{ 
        display: 'flex', 
        width: '100%', 
        height: '100%', 
        flexDirection: 'row', 
        background: 'transparent' 
      }}>
        {Array.from({ length: numCols }).map((_, colIndex) => {
          const items = clusters[colIndex] || [];
          const isPresentBox = colIndex === numCols - 1;
          const isGapBox = colIndex === numCols - 2;
          const isActive = items.some(i => i.index === timeMachineIndex) || (isPresentBox && timeMachineIndex === -1);
          const isArmed = items.some(i => i.snapshot.id === armedSnapshotId);
          const isEmpty = items.length === 0 && !isPresentBox && !isGapBox;
          const hasItems = items.length > 0;
          const primary = items[0];

          return (
            <div 
              key={colIndex}
              className={`timeline-cluster ${isActive && !isEmpty ? 'active' : ''} ${isArmed ? 'armed' : ''} ${isEmpty ? 'empty' : ''} ${isPresentBox ? 'present-box' : ''}`}
              style={{ 
                flex: `0 0 ${charWidth ? charWidth + 'px' : '2%'}`, 
                width: charWidth ? `${charWidth}px` : '2%',
                height: charWidth ? `${charWidth}px` : '100%',
                position: 'relative'
              }}
            >
              <div 
                className={`timeline-box ${isEmpty && !isPresentBox && !isGapBox ? 'empty-box' : 'base-box'} ${isGapBox ? 'gap-box' : ''} ${isActive ? 'active' : ''} ${isArmed && !isEmpty ? 'armed' : ''}`}
                style={{ width: '100%', height: '100%' }}
                  onClick={isPresentBox ? handlePresentLeftClick : (hasItems ? (e) => handleBoxLeftClick(e, primary.index, items.length > 1, colIndex) : undefined)}
                  onContextMenu={hasItems && !isPresentBox ? (e) => handleBoxRightClick(e, primary.index, primary.snapshot) : undefined}
                  title={isPresentBox ? (timeMachineIndex === -1 ? "Present (Auto)" : "Return to Present") : (hasItems ? new Date(primary.snapshot.timestamp).toLocaleString() : undefined)}
              >
                  {hasItems && !isPresentBox && primary.snapshot.isManual && <div className="manual-dot" />}
              </div>

                {hasItems && !isPresentBox && (
                 <>
                  {items.length > 1 && (
                    <div className={`timeline-flyout ${openFlyoutCol === colIndex ? 'is-open' : ''}`}>
                      {items.map(item => (
                        <div 
                          key={item.snapshot.id} 
                          className={`timeline-box base-flyout-box ${item.index === timeMachineIndex ? 'active' : ''} ${item.snapshot.id === armedSnapshotId ? 'armed' : ''}`}
                          style={{ width: charWidth ? `${charWidth}px` : '100%', height: charWidth ? `${charWidth}px` : '100%' }}
                          onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); handleFlyoutItemClick(item.index); }}
                          onContextMenu={(e) => handleBoxRightClick(e, item.index, item.snapshot)}
                          title={new Date(item.snapshot.timestamp).toLocaleString()}
                        >
                          {item.snapshot.isManual && <div className="manual-dot" />}
                        </div>
                      ))}
                    </div>
                  )}
                 </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
