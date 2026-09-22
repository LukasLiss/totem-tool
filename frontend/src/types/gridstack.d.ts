import 'gridstack';

declare module 'gridstack' {
  interface GridStackWidget {
    component_id?: number;
    component_name?: string;
    order?: number;
    text?: string;
    font_size?: number;
    color?: string;
    image?: string;
    automatic_loading?: boolean;
    leading_object_type?: string;
    extraction?: 'leading_1hop' | 'leading_bfs' | 'connected' | 'resource_aware';
    iso?: 'db_signature' | 'trace' | 'signature' | 'wl' | 'wl+vf2' | 'exact';
    timeout_s?: number;
    business_object_types?: string[];
    business_activities?: string[];
    show_num_events?: boolean;
    show_num_activities?: boolean;
    show_num_objects?: boolean;
    show_num_object_types?: boolean;
    show_earliest_timestamp?: boolean;
    show_newest_timestamp?: boolean;
    show_duration?: boolean;
    show_controls?: boolean;
    initial_interaction_locked?: boolean;
    file_id?: number | null;
    x_axis?: string;
    y_axis?: string;
    color_by?: string;
    shape_by?: string;
    row_order?: 'first_occurrence' | 'last_occurrence';
    max_points?: number;
    show_minimap?: boolean;
    layout_direction?: 'TB' | 'LR';
    // ImageComponent (asset store)
    image_asset?: number | null;
    image_asset_url?: string | null;
    image_fit?: string;
    image_alignment?: string;
    // OCCNComponent
    relative_occurrence_threshold?: number;
    object_types?: string;
    // SqlQueryComponent / PieChartComponent
    query?: string;
    // SqlQueryComponent
    name?: string;
    row_limit?: number;
    // SQL-driven widgets: link to a stored query (QUERY project asset)
    query_asset?: number | null;
    query_asset_name?: string | null;
    // KpiComponent
    prefix?: string;
    suffix?: string;
    decimals?: number;
    // BarChartComponent
    horizontal?: boolean;
    show_values?: boolean;
    // ScatterPlotComponent
    x_column?: string;
    y_column?: string;
    series_column?: string;
    x_label?: string;
    y_label?: string;
    ring_text?: string;
    chart_type?: string;
    title?: string;
    show_legend?: boolean;
    show_tooltip?: boolean;
    label_column?: string;
    value_column?: string;
    // FilterStackComponent
    filter_stack_json?: unknown;
    // OCHandoverComponent (show_controls / automatic_loading are shared above)
    method?: 'oc' | 'flattened';
    resource_types?: string[];
    businessobject_types?: string[];
    case_type?: string;
    flat_resource_type?: string;
    max_gap?: number | null;
    normalization?: 'by_source' | 'by_target' | 'by_arcs_in_eog' | 'by_total_weight';
    normalization_scope?: 'global' | 'per_bo_type';
    parallel_filter_enabled?: boolean;
    parallel_threshold?: number;
    min_parallel_observations?: number;
    cluster_by_ot?: boolean;
    view_mode?: 'graph' | 'table' | 'log';
    // ResourceProfilingComponent (business_object_types / resource_types shared)
    feature_groups?: string[];
    tooltip_feature_groups?: string[];
    compute_clusters?: boolean;
    cluster_method?: 'kmeans' | 'agglomerative' | 'hdbscan';
    n_clusters?: number;
    min_cluster_size?: number;
    distance_metric?: 'euclidean' | 'hellinger';
    // ProcessAreaComponent
    algorithm?: 'mlpa' | 'advanced';
    w_temporal?: number;
    w_cardinality?: number;
    w_divergence?: number;
    alpha?: number;
    beta?: number;
  }
}
