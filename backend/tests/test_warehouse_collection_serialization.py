from bson import ObjectId

from app.services.warehouse_collection_service import _serialize_mongo_values


def test_serialize_mongo_values_converts_nested_object_ids():
    nested_id = ObjectId()
    root_id = ObjectId()

    payload = {
        "_id": root_id,
        "pickupLocation": {
            "locationId": nested_id,
            "coordinates": [1.0, 2.0],
        },
        "metadata": (
            {"relatedIds": [nested_id]},
        ),
    }

    result = _serialize_mongo_values(payload)

    assert result["_id"] == str(root_id)
    assert result["pickupLocation"]["locationId"] == str(nested_id)
    assert result["pickupLocation"]["coordinates"] == [1.0, 2.0]
    assert result["metadata"][0]["relatedIds"] == [str(nested_id)]
    assert isinstance(result["metadata"], list)
