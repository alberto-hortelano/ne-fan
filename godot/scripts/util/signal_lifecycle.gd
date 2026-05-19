## Auto-disconnect helper for nodes that subscribe to signals on long-lived
## autoloads. Use from `_ready` like:
##
##     SignalLifecycle.auto_disconnect(self, GameStore.state_changed, _on_state_changed)
##
## The helper connects the signal **and** schedules a disconnect when the
## subscriber leaves the scene tree. Without this, every transient node that
## subscribes to an autoload signal accumulates a stale callback over the
## session — a bug class CLAUDE.md calls out in §1.5 of next.md.
##
## Autoload-to-autoload connections do NOT need this helper: both ends live for
## the whole app, so disconnecting is moot. Document those with an inline
## `# OK: autoload, vida == app`.
class_name SignalLifecycle
extends RefCounted


static func auto_disconnect(subscriber: Node, signal_ref: Signal, callable: Callable) -> void:
	signal_ref.connect(callable)
	subscriber.tree_exiting.connect(
		func():
			if signal_ref.is_connected(callable):
				signal_ref.disconnect(callable),
		CONNECT_ONE_SHOT,
	)
