import { useState } from "react";
import { COPY_WARNING, JOIN_PENDING, useCopyWarning } from "../../../sync/copiedState";
import { finishCopyJoin, rejoinAsNewDevice } from "../../../sync/engine";
import { Button, Group, Row } from "../controls";

const KEY_NEEDED = "Rejoining needs the sync key: enter your recovery phrase first.";

export function CopiedSyncWarning() {
  const conflict = useCopyWarning((s) => s.conflict);
  const joinPending = useCopyWarning((s) => s.joinPending);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!conflict && !joinPending) return null;
  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    setFailed(false);
    try {
      setFailed(!(await action()));
    } finally {
      setBusy(false);
    }
  };
  const description = joinPending ? JOIN_PENDING : COPY_WARNING;
  return (
    <Group style={{ marginTop: 12 }}>
      <Row
        title={joinPending ? "This Mac isn't syncing yet" : "This Mac shares its sync identity"}
        description={failed ? `${description} ${KEY_NEEDED}` : description}
      >
        {joinPending ? (
          <Button title={busy ? "Trying…" : "Try Again"} kind="primary" disabled={busy} onPress={() => void run(finishCopyJoin)} />
        ) : (
          <Button title={busy ? "Rejoining…" : "Rejoin as New Device"} kind="primary" disabled={busy} onPress={() => void run(rejoinAsNewDevice)} />
        )}
      </Row>
    </Group>
  );
}
