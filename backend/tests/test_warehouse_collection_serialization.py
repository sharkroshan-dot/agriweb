from bson import ObjectId

from app.services.warehouse_collection_service import (
    _serialize_mongo_values,
    farmer_collection_district,
    warehouse_collection_districts,
)


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


def test_explicit_farm_collection_districts_override_settings_location():
    warehouse = {
        "farmCollectionDistricts": ["Perambalur"],
        "address": {"city": "Krishnagiri"},
    }

    assert warehouse_collection_districts(warehouse) == {"perambalur"}


def test_settings_city_is_fallback_when_farm_collection_districts_are_empty():
    warehouse = {
        "farmCollectionDistricts": [],
        "address": {"city": "Trichirapalli"},
    }

    assert warehouse_collection_districts(warehouse) == {"tiruchirappalli"}


def test_farmer_address_district_matches_warehouse_coverage_alias():
    profile = {"farmAddress": {"formattedAddress": "Near Trichy, Tamil Nadu"}}

    assert farmer_collection_district(profile, {}, {"tiruchirappalli"}) == "tiruchirappalli"
    assert farmer_collection_district(profile, {}, {"krishnagiri"}) is None
