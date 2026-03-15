import pytest
import totem_lib
import pandas as pd
import polars as pl
from pandas.api.types import is_datetime64_any_dtype, is_string_dtype, is_object_dtype

OCEL_FILES = [
    "example_data/ContainerLogistics.json",
    "example_data/ContainerLogistics.sqlite",
    "example_data/ContainerLogistics.xml",
    "example_data/toy_example_ocel2.csv",
    "example_data/ocel2-p2p.json",
]

def id_fn(filepath):
    """Creates a clean name for the pytest output based on the filename."""
    return filepath.split("/")[-1]

@pytest.fixture(scope="module", params=OCEL_FILES, ids=id_fn)
def loaded_ocel(request):
    """Import and convert OCEL once for all tests in this file."""
    ocel = totem_lib.import_ocel(request.param)
    converted = totem_lib.convert_ocel_polars_to_pm4py(ocel)
    return {"ocel": ocel, "converted": converted}


def test_columns(loaded_ocel):
    """Test that the converted OCEL has the expected columns with correct types."""

    def validate_columns(df, expected_tuples):
        errors = []

        for col_name, expected_type in expected_tuples:
            # Check if column exists
            if col_name not in df.columns:
                errors.append(f"Missing column: '{col_name}'")
                continue

            # Check for datetime
            if expected_type == "datetime":
                if not is_datetime64_any_dtype(df[col_name]):
                    errors.append(
                        f"Column '{col_name}' is {df[col_name].dtype}, expected datetime"
                    )
                    
            # String cols are object in Pandas<3.0.0 but string in Pandas>=3.0.0. We allow both here
            elif expected_type is object:
                if not (is_object_dtype(df[col_name]) or is_string_dtype(df[col_name])):
                    errors.append(f"Column '{col_name}' is {df[col_name].dtype}, expected object or string")

            # Check for other types
            else:
                if df[col_name].dtype != expected_type:
                    errors.append(
                        f"Column '{col_name}' is {df[col_name].dtype}, expected {expected_type}"
                    )

        if errors:
            raise AssertionError(f"Validation errors found: {errors}")

    converted_ocel = loaded_ocel["converted"]

    # Check expected columns with types
    expected_event_columns = [
        (converted_ocel.event_id_column, object),
        (converted_ocel.event_activity, object),
        (converted_ocel.event_timestamp, "datetime"),
    ]
    validate_columns(converted_ocel.events, expected_event_columns)

    # Note: May have additional attribute columns depending on the concrete instance
    expected_object_columns = [
        (converted_ocel.object_id_column, object),
        (converted_ocel.object_type_column, object),
    ]
    validate_columns(converted_ocel.objects, expected_object_columns)

    expected_relations_columns = [
        (converted_ocel.event_id_column, object),
        (converted_ocel.event_activity, object),
        (converted_ocel.event_timestamp, "datetime"),
        (converted_ocel.object_id_column, object),
        (converted_ocel.object_type_column, object),
        (converted_ocel.qualifier, object),
    ]
    validate_columns(converted_ocel.relations, expected_relations_columns)

    if not converted_ocel.o2o.empty:
        expected_o2o_columns = [
            (converted_ocel.object_id_column, object),
            (f"{converted_ocel.object_id_column}_2", object),
            (converted_ocel.qualifier, object),
        ]
        validate_columns(converted_ocel.o2o, expected_o2o_columns)

    if not converted_ocel.e2e.empty:
        expected_e2e_columns = [
            (converted_ocel.event_id_column, object),
            (f"{converted_ocel.event_id_column}_2", object),
            (converted_ocel.qualifier, object),
        ]
        validate_columns(converted_ocel.e2e, expected_e2e_columns)

    # Note: May have additional columns depending on the instance
    if not converted_ocel.object_changes.empty:
        expected_changes_columns = [
            (converted_ocel.object_id_column, object),
            (converted_ocel.object_type_column, object),
            (converted_ocel.event_timestamp, "datetime"),
            (converted_ocel.changed_field, object),
        ]
        validate_columns(converted_ocel.object_changes, expected_changes_columns)


def assert_dataframes_match(
    df_pl: pl.DataFrame, df_pd: pd.DataFrame, column_mappings: list
):
    """
    Generic method to compare specific columns between a Polars and Pandas DataFrame.

    Args:
        df_pl: The Polars DataFrame.
        df_pd: The Pandas DataFrame.
        column_mappings: List of tuples in the format
                         (polars_col_name, pandas_col_name, is_timestamp_bool).
    """
    # Convert Polars to Pandas
    pl_as_pd = df_pl.to_pandas()

    # Extract structural lists from mappings
    pl_cols = [mapping[0] for mapping in column_mappings]
    pd_cols = [mapping[1] for mapping in column_mappings]
    ts_cols = [mapping[0] for mapping in column_mappings if mapping[2]]

    # Filter dfs
    pl_subset = pl_as_pd[pl_cols].copy()
    pd_subset = df_pd[pd_cols].copy()

    # Align col names
    rename_dict = {pd_col: pl_col for pl_col, pd_col, _ in column_mappings}
    pd_subset = pd_subset.rename(columns=rename_dict)

    # Convert timestamps, cast other cols to string (valid since polars ocel scheme is string-based)
    for pl_col, _, is_ts in column_mappings:
        if is_ts:
            pl_subset[pl_col] = pl_subset[pl_col].astype("Int64")

            # Convert Pandas datetime (ns) to Unix timestamp (s)
            pd_subset[pl_col] = pd_subset[pl_col].astype("int64") // 10**9
            pd_subset[pl_col] = pd_subset[pl_col].astype("Int64")
        else:
            # Cast all non-timestamp columns to string to prevent mismatches
            pl_subset[pl_col] = pl_subset[pl_col].astype(str)
            pd_subset[pl_col] = pd_subset[pl_col].astype(str)

    # Sort dfs
    sort_cols = ts_cols + [col for col in pl_cols if col not in ts_cols]

    pl_subset = pl_subset.sort_values(by=sort_cols).reset_index(drop=True)
    pd_subset = pd_subset.sort_values(by=sort_cols).reset_index(drop=True)

    # Check if shapes are same
    if pl_subset.shape != pd_subset.shape:
        # Perform a full outer join
        diff = pd.merge(pl_subset, pd_subset, how="outer", indicator=True)

        # Isolate the missing rows
        missing_in_pd = diff[diff["_merge"] == "left_only"].drop(columns=["_merge"])
        missing_in_pl = diff[diff["_merge"] == "right_only"].drop(columns=["_merge"])

        error_msg = f"Shape mismatch: Polars df is {pl_subset.shape}, Pandas df is {pd_subset.shape}.\n"

        if not missing_in_pd.empty:
            error_msg += f"\n--- Rows ONLY in Polars (Missing in Pandas, first 10) ---\n{missing_in_pd.head(10)}\n"
        if not missing_in_pl.empty:
            error_msg += f"\n--- Rows ONLY in Pandas (Missing in Polars, first 10) ---\n{missing_in_pl.head(10)}\n"

        raise AssertionError(error_msg)

    # Assert exact match
    pd.testing.assert_frame_equal(pl_subset, pd_subset, check_like=True)


def test_events(loaded_ocel):
    """Tests that the events are converted correctly with expected values."""
    ocel = loaded_ocel["ocel"]
    converted_ocel = loaded_ocel["converted"]

    # Define col mapping
    event_mappings = [
        ("_eventId", converted_ocel.event_id_column, False),
        ("_activity", converted_ocel.event_activity, False),
        ("_timestampUnix", converted_ocel.event_timestamp, True),
    ]

    # Make sure contents are equal
    assert_dataframes_match(
        df_pl=ocel.events, df_pd=converted_ocel.events, column_mappings=event_mappings
    )


def test_objects(loaded_ocel):
    """Tests that the objects are converted correctly with expected values."""
    ocel = loaded_ocel["ocel"]
    converted_ocel = loaded_ocel["converted"]

    # Define col mapping
    object_mappings = [
        ("_objId", converted_ocel.object_id_column, False),
        ("_objType", converted_ocel.object_type_column, False),
    ]

    # Make sure contents are equal
    assert_dataframes_match(
        df_pl=ocel.objects,
        df_pd=converted_ocel.objects,
        column_mappings=object_mappings,
    )


def test_relations(loaded_ocel):
    """Tests that the relations are converted correctly with expected values."""
    ocel = loaded_ocel["ocel"]
    converted_ocel = loaded_ocel["converted"]

    # ocel.events has lists for _objects and _qualifiers
    # join ocel.events and objects together to handle qualifiers
    # explode obj and qualifiers
    exploded_events = ocel.events.explode(["_objects", "_qualifiers"])
    # join on objId
    ocel_events = exploded_events.join(
        ocel.objects, left_on="_objects", right_on="_objId", how="left"
    )

    # Define col mapping
    object_mappings = [
        ("_eventId", converted_ocel.event_id_column, False),
        ("_activity", converted_ocel.event_activity, False),
        ("_timestampUnix", converted_ocel.event_timestamp, True),
        ("_objects", converted_ocel.object_id_column, False),
        ("_qualifiers", converted_ocel.qualifier, False),
        ("_objType", converted_ocel.object_type_column, False),
    ]

    # Make sure contents are equal
    assert_dataframes_match(
        df_pl=ocel_events,
        df_pd=converted_ocel.relations,
        column_mappings=object_mappings,
    )


def test_o2o(loaded_ocel):
    """Tests that the object-to-object relations are converted correctly with expected values."""
    ocel = loaded_ocel["ocel"]
    converted_ocel = loaded_ocel["converted"]

    if converted_ocel.o2o.empty:
        assert ocel.o2o_graph_edges().empty
    else:
        # explode object table to get all pairs
        ocel_o2o = ocel.objects.explode(["_targetObjects", "_qualifiers"]).drop_nulls()

        # Define col mapping
        o2o_mappings = [
            ("_objId", converted_ocel.object_id_column, False),
            ("_targetObjects", f"{converted_ocel.object_id_column}_2", False),
            ("_qualifiers", converted_ocel.qualifier, False),
        ]

        # Make sure contents are equal
        assert_dataframes_match(
            df_pl=ocel_o2o,
            df_pd=converted_ocel.o2o,
            column_mappings=o2o_mappings,
        )


def test_e2e(loaded_ocel):
    """Tests that the event-to-event relations are converted correctly with expected values."""

    # Polars OCEL does not keep e2e relations
    # assert that the converted e2e is empty
    converted_ocel = loaded_ocel["converted"]
    assert converted_ocel.e2e.empty


@pytest.mark.skip(reason="Object changes are not yet implemented in the converter.")
def test_object_changes(loaded_ocel):
    """Tests that the object changes are converted correctly with expected values."""
    raise NotImplementedError()