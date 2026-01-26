// Tiny shared popup queue to prevent overlapping modals
(function () {
  if (window.JobHackAIPopupQueue) return;

  const queue = [];
  let active = false;

  const runNext = () => {
    if (queue.length === 0) {
      active = false;
      return;
    }
    active = true;
    const task = queue.shift();
    let finished = false;

    const done = () => {
      if (finished) return;
      finished = true;
      runNext();
    };

    try {
      const result = task(done);
      if (result && typeof result.then === 'function') {
        result.then(done).catch(done);
      } else if (task.length === 0) {
        // No callback and no promise => finish immediately
        done();
      }
    } catch (_) {
      done();
    }
  };

  const enqueue = (task) => {
    if (typeof task !== 'function') return;
    queue.push(task);
    if (!active) runNext();
  };

  window.JobHackAIPopupQueue = { enqueue };
})();
