from datetime import datetime, timezone

import pytest

from serving_projection.projection.checkpoint import TimestampCheckpoint, epoch_checkpoint


def test_round_trips_through_dict():
    checkpoint = TimestampCheckpoint(value=datetime(2026, 9, 1, 12, 30, tzinfo=timezone.utc))
    restored = TimestampCheckpoint.from_dict(checkpoint.to_dict())
    assert restored.value == checkpoint.value


def test_epoch_checkpoint_is_before_any_real_data():
    assert epoch_checkpoint().value < datetime(2000, 1, 1, tzinfo=timezone.utc)


def test_from_dict_rejects_unknown_type():
    with pytest.raises(ValueError):
        TimestampCheckpoint.from_dict({"type": "sequence", "value": "5"})
