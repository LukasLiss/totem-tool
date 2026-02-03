import { X } from 'lucide-react';

type HistogramType = 'temporal' | 'logCardinality' | 'eventCardinality';

type HistogramFloatingPanelProps = {
  title: string;
  data: Record<string, number>;
  position: { x: number; y: number };
  onClose: () => void;
  type: HistogramType;
};

const TEMPORAL_LABELS: Record<string, string> = {
  D: 'Dependent',
  Di: 'Dependent-Inv',
  I: 'Initiating',
  Ii: 'Initiating-Inv',
  P: 'Parallel',
  total: 'Total',
};

const CARDINALITY_LABELS: Record<string, string> = {
  '0': 'Zero',
  '1': 'One',
  '0...1': 'Zero-One',
  '1..*': 'Many',
  '0...*': 'Zero-Many',
  total: 'Total',
};

function getLabelsForType(type: HistogramType): Record<string, string> {
  return type === 'temporal' ? TEMPORAL_LABELS : CARDINALITY_LABELS;
}

function getRelationKeysForType(type: HistogramType): string[] {
  return type === 'temporal'
    ? ['D', 'Di', 'I', 'Ii', 'P']
    : ['0', '1', '0...1', '1..*', '0...*'];
}

export function HistogramFloatingPanel({
  title,
  data,
  position,
  onClose,
  type,
}: HistogramFloatingPanelProps) {
  const labels = getLabelsForType(type);
  const relationKeys = getRelationKeysForType(type);
  const total = data['total'] || 0;

  // Calculate position to avoid going off-screen
  const panelWidth = 300;
  const panelHeight = 280;
  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

  let left = position.x + 10;
  let top = position.y + 10;

  // Adjust if panel would go off right edge
  if (left + panelWidth > windowWidth - 20) {
    left = position.x - panelWidth - 10;
  }

  // Adjust if panel would go off bottom edge
  if (top + panelHeight > windowHeight - 20) {
    top = position.y - panelHeight - 10;
  }

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 1000,
        width: panelWidth,
      }}
      className="bg-white border border-gray-200 rounded-lg shadow-lg"
    >
      <div className="flex justify-between items-center p-3 border-b border-gray-100">
        <h4 className="font-semibold text-sm text-gray-800">{title}</h4>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-1.5 font-medium text-gray-600">Relation</th>
              <th className="text-right py-1.5 font-medium text-gray-600">Count</th>
              <th className="text-right py-1.5 font-medium text-gray-600">%</th>
            </tr>
          </thead>
          <tbody>
            {relationKeys.map((key) => {
              const count = data[key] || 0;
              const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
              return (
                <tr key={key} className="border-b border-gray-50">
                  <td className="py-1.5 text-gray-700">{labels[key] || key}</td>
                  <td className="text-right py-1.5 text-gray-900">{count}</td>
                  <td className="text-right py-1.5 text-gray-500">{pct}%</td>
                </tr>
              );
            })}
            <tr className="bg-gray-50 font-medium">
              <td className="py-1.5 text-gray-700">{labels['total']}</td>
              <td className="text-right py-1.5 text-gray-900">{total}</td>
              <td className="text-right py-1.5 text-gray-500">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ActivityHistogramPanelProps = {
  sourceType: string;
  targetType: string;
  histogramByActivity: Record<string, Record<string, number>>;
  position: { x: number; y: number };
  onClose: () => void;
};

export function ActivityHistogramPanel({
  sourceType,
  targetType,
  histogramByActivity,
  position,
  onClose,
}: ActivityHistogramPanelProps) {
  // Filter histogram entries for this type pair
  const prefix = `${sourceType}|${targetType}|`;
  const activities = Object.entries(histogramByActivity)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, counts]) => ({
      activity: key.slice(prefix.length),
      counts,
    }))
    .sort((a, b) => a.activity.localeCompare(b.activity));

  const cardinalityKeys = ['0', '1', '0...1', '1..*', '0...*'];

  // Calculate position to avoid going off-screen
  const panelWidth = 450;
  const panelHeight = Math.min(400, 100 + activities.length * 28);
  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

  let left = position.x + 10;
  let top = position.y + 10;

  if (left + panelWidth > windowWidth - 20) {
    left = position.x - panelWidth - 10;
  }

  if (top + panelHeight > windowHeight - 20) {
    top = position.y - panelHeight - 10;
  }

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 1000,
        width: panelWidth,
        maxHeight: 400,
      }}
      className="bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
    >
      <div className="flex justify-between items-center p-3 border-b border-gray-100">
        <div>
          <h4 className="font-semibold text-sm text-gray-800">Event Cardinality by Activity</h4>
          <p className="text-xs text-gray-500">
            {sourceType} → {targetType}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-3 overflow-auto" style={{ maxHeight: 340 }}>
        {activities.length === 0 ? (
          <p className="text-gray-500 text-sm">No activity data available</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 font-medium text-gray-600">Activity</th>
                <th className="text-right py-1.5 font-medium text-gray-600 px-1">Total</th>
                {cardinalityKeys.map((key) => (
                  <th key={key} className="text-right py-1.5 font-medium text-gray-600 px-1 text-xs">
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activities.map(({ activity, counts }) => {
                const total = counts['total'] || 0;
                return (
                  <tr key={activity} className="border-b border-gray-50">
                    <td className="py-1.5 text-gray-700 truncate max-w-[150px]" title={activity}>
                      {activity}
                    </td>
                    <td className="text-right py-1.5 text-gray-900 px-1">{total}</td>
                    {cardinalityKeys.map((key) => {
                      const count = counts[key] || 0;
                      return (
                        <td key={key} className="text-right py-1.5 text-gray-600 px-1 text-xs">
                          {count}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

type RelationTypeHistogramPanelProps = {
  title: string;
  sourceType: string;
  targetType: string;
  histogramByRelationType: Record<string, Record<string, number>>;
  position: { x: number; y: number };
  onClose: () => void;
  type: 'temporal' | 'logCardinality';
};

export function RelationTypeHistogramPanel({
  title,
  sourceType,
  targetType,
  histogramByRelationType,
  position,
  onClose,
  type,
}: RelationTypeHistogramPanelProps) {
  // Filter histogram entries for this type pair
  const prefix = `${sourceType}|${targetType}|`;
  const relationTypes = Object.entries(histogramByRelationType)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, counts]) => ({
      relationType: key.slice(prefix.length),
      counts,
    }))
    .sort((a, b) => a.relationType.localeCompare(b.relationType));

  const labels = type === 'temporal' ? TEMPORAL_LABELS : CARDINALITY_LABELS;
  const relationKeys = type === 'temporal'
    ? ['D', 'Di', 'I', 'Ii', 'P']
    : ['0', '1', '0...1', '1..*', '0...*'];

  // Calculate position
  const panelWidth = 420;
  const panelHeight = Math.min(350, 100 + relationTypes.length * 28);
  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

  let left = position.x + 10;
  let top = position.y + 10;

  if (left + panelWidth > windowWidth - 20) {
    left = position.x - panelWidth - 10;
  }

  if (top + panelHeight > windowHeight - 20) {
    top = position.y - panelHeight - 10;
  }

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 1000,
        width: panelWidth,
        maxHeight: 350,
      }}
      className="bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
    >
      <div className="flex justify-between items-center p-3 border-b border-gray-100">
        <div>
          <h4 className="font-semibold text-sm text-gray-800">{title}</h4>
          <p className="text-xs text-gray-500">
            {sourceType} → {targetType}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-3 overflow-auto" style={{ maxHeight: 290 }}>
        {relationTypes.length === 0 ? (
          <p className="text-gray-500 text-sm">No relation type data available</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 font-medium text-gray-600">Relation Type</th>
                <th className="text-right py-1.5 font-medium text-gray-600 px-1">Total</th>
                {relationKeys.map((key) => (
                  <th key={key} className="text-right py-1.5 font-medium text-gray-600 px-1 text-xs">
                    {labels[key]?.substring(0, 3) || key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {relationTypes.map(({ relationType, counts }) => {
                const total = counts['total'] || 0;
                return (
                  <tr key={relationType} className="border-b border-gray-50">
                    <td className="py-1.5 text-gray-700" title={relationType}>
                      {relationType}
                    </td>
                    <td className="text-right py-1.5 text-gray-900 px-1">{total}</td>
                    {relationKeys.map((key) => {
                      const count = counts[key] || 0;
                      return (
                        <td key={key} className="text-right py-1.5 text-gray-600 px-1 text-xs">
                          {count}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default HistogramFloatingPanel;
