import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { executeQuery} from '@/api/fileApi';
import { GridStackNode } from 'gridstack';

interface OCELQueryComponentProps {
  node: GridStackNode & {
    component_id: number;
    component_name?: string;
    query?: string;
  };
  onUpdate?: (updates: Partial<GridStackNode> & Record<string, any>) => void;
  isEditMode?: boolean;
  dashboardId: number;
  selectedFile?: { id: number; [key: string]: any };
}

const OCELQueryComponent: React.FC<OCELQueryComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  const [query, setQuery] = useState(node.query || 'SELECT * FROM events LIMIT 10');
  const [results, setResults] = useState<{ data: any[]; columns: string[] } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync query with node when it changes
  useEffect(() => {
    setQuery(node.query || 'SELECT * FROM events LIMIT 10');
  }, [node.query]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    onUpdate?.({ query: value });
  };

  const handleExecuteQuery = async () => {
    if (!selectedFile?.id) {
      setError('No file selected');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);

    const token = localStorage.getItem('access_token');
    if (!token) {
      setError('No access token found');
      setIsLoading(false);
      return;
    }

    try {
      const result = await executeQuery(token, selectedFile.id.toString(), query);
      setResults(result);
    } catch (err: any) {
      setError(err.message || 'Failed to execute query');
    } finally {
      setIsLoading(false);
    }
  };

  /*const handleExportCSV = async () => {
    if (!selectedFile?.id) {
      setError('No file selected');
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) {
      setError('No access token found');
      return;
    }

    try {
      const blob = await exportQueryToCSV(token, selectedFile.id.toString(), query);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `query_results_${selectedFile.id}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(err.message || 'Failed to export CSV');
    }
  };*/

  if (isEditMode) {
    return (
      <Card className="w-full h-full rounded-none">
        <CardHeader>
          <CardTitle>OCEL Query Component</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">SQL Query</label>
            <Textarea
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Enter SQL query..."
              className="w-full h-32"
            />
          </div>
          <div className="text-sm text-muted-foreground">
            Available tables: events, objects, object_attributes
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full h-full rounded-none">
      <CardHeader>
        <CardTitle>OCEL Query</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Textarea
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Enter SQL query..."
            className="w-full h-24"
          />
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleExecuteQuery}
            disabled={isLoading || !selectedFile?.id}
            className="flex-1"
          >
            {isLoading ? 'Executing...' : 'Execute Query'}
          </Button>
          {/*<Button
            onClick={handleExportCSV}
            disabled={!results || !selectedFile?.id}
            variant="outline"
          >
            Export CSV
          </Button>\*/}
        </div>
        {error && (
          <div className="text-red-500 text-sm">{error}</div>
        )}
        {results && (
          <div className="border rounded max-h-64 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {results.columns.map((col, idx) => (
                    <TableHead key={idx}>{col}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.data.slice(0, 100).map((row, idx) => (
                  <TableRow key={idx}>
                    {results.columns.map((col, colIdx) => (
                      <TableCell key={colIdx}>
                        {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {results.data.length > 100 && (
                  <TableRow>
                    <TableCell colSpan={results.columns.length} className="text-center text-muted-foreground">
                      ... and {results.data.length - 100} more rows
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default OCELQueryComponent;