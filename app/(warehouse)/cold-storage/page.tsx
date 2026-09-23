"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Progress } from "../../components/ui/progress";
import { Snowflake, Thermometer, AlertTriangle, CheckCircle2 } from "lucide-react";

const chambers = [
  { name: "Chamber A", temp: "4°C", status: "Stable", health: 87 },
  { name: "Chamber B", temp: "-5°C", status: "Monitoring", health: 72 },
  { name: "Chamber C", temp: "2°C", status: "Alert", health: 48 },
];

export default function ColdStoragePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Cold Storage</h1>
        <p className="text-muted-foreground">Track refrigeration health and temperature-sensitive inventory.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {chambers.map((item) => (
          <Card key={item.name}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{item.name}</CardTitle>
                <Badge variant={item.status === "Alert" ? "destructive" : item.status === "Monitoring" ? "warning" : "success"}>{item.status}</Badge>
              </div>
              <CardDescription>Temperature-controlled storage</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                <Snowflake className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-sm font-medium">Current Temp</p>
                  <p className="text-lg font-semibold">{item.temp}</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><Thermometer className="h-4 w-4" />Health</span>
                  <span>{item.health}%</span>
                </div>
                <Progress value={item.health} />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {item.status === "Alert" ? <AlertTriangle className="h-4 w-4 text-red-600" /> : <CheckCircle2 className="h-4 w-4 text-green-600" />}
                {item.status === "Alert" ? "Immediate action required" : "Within acceptable range"}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
