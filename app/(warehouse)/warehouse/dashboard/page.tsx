"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Warehouse,
  Package,
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Progress } from "../../../components/ui/progress";
import { cn } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function WarehouseDashboardPage() {
  const [period, setPeriod] = useState<"week" | "month" | "year">("week");
  const { data: dashboardData, isLoading, refetch } = useQuery({
    queryKey: ["warehouseDashboard", period],
    queryFn: () => api.get(`/warehouse/me/dashboard?period=${period}`),
  });

  const inventoryData = [
    { name: "Mon", received: 45, dispatched: 30 },
    { name: "Tue", received: 52, dispatched: 35 },
    { name: "Wed", received: 38, dispatched: 42 },
    { name: "Thu", received: 60, dispatched: 45 },
    { name: "Fri", received: 48, dispatched: 38 },
    { name: "Sat", received: 35, dispatched: 25 },
    { name: "Sun", received: 20, dispatched: 15 },
  ];

  const categoryData = [
    { name: "Vegetables", value: 45 },
    { name: "Fruits", value: 30 },
    { name: "Grains", value: 15 },
    { name: "Dairy", value: 10 },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">{[1,2,3,4].map((i)=><div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />)}</div>
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Warehouse Dashboard</h1>
          <p className="text-muted-foreground">Delhi Central Warehouse • 75% capacity used</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-1">
            {(["week","month","year"] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", period === p ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{p.charAt(0).toUpperCase() + p.slice(1)}</button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          { title: "Total Items", value: "1,245", change: "+12.5%", icon: Package, color: "text-blue-600" },
          { title: "Stock Value", value: "₹25,00,000", change: "+8.2%", icon: Warehouse, color: "text-green-600" },
          { title: "Incoming Today", value: "5", change: "+3", icon: ArrowDown, color: "text-purple-600" },
          { title: "Outgoing Today", value: "10", change: "+7", icon: ArrowUp, color: "text-orange-600" },
        ].map((stat, index) => (
          <Card key={index}><CardContent className="p-6"><div className="flex items-center justify-between"><div className="space-y-1"><p className="text-sm text-muted-foreground">{stat.title}</p><p className="text-2xl font-bold">{stat.value}</p></div><div className={cn("rounded-full p-2 bg-muted", stat.color)}><stat.icon className="h-5 w-5" /></div></div><div className="mt-2 text-sm text-muted-foreground">{stat.change} from last {period}</div></CardContent></Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Inventory Flow</CardTitle><CardDescription>Received vs Dispatched items</CardDescription></CardHeader>
          <CardContent>
            <div className="h-[300px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={inventoryData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Area type="monotone" dataKey="received" stroke="#22c55e" strokeWidth={2} fillOpacity={1} fill="url(#colorReceived)" /><Area type="monotone" dataKey="dispatched" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorDispatched)" /><defs><linearGradient id="colorReceived" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient><linearGradient id="colorDispatched" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient></defs></AreaChart></ResponsiveContainer></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Stock by Category</CardTitle><CardDescription>Distribution of inventory</CardDescription></CardHeader>
          <CardContent>
            <div className="h-[250px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">{categoryData.map((entry,index)=><Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>
            <div className="mt-4 grid grid-cols-2 gap-2">{categoryData.map((item,index)=><div key={item.name} className="flex items-center gap-2 text-sm"><div className={cn("h-3 w-3 rounded-full", index === 0 && "bg-green-500", index === 1 && "bg-blue-500", index === 2 && "bg-yellow-500", index === 3 && "bg-red-500")} /><span>{item.name}</span><span className="ml-auto font-medium">{item.value}%</span></div>)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Capacity Utilization</CardTitle><CardDescription>Storage space usage</CardDescription></CardHeader>
          <CardContent>
            <div className="space-y-6">
              {[{label:'General Storage', value:'15,000 / 20,000 sq ft', percent:75},{label:'Cold Storage', value:'500 / 1,000 sq ft', percent:50},{label:'Frozen Storage', value:'200 / 500 sq ft', percent:40}].map((item,index)=><div key={index}><div className="flex justify-between text-sm"><span>{item.label}</span><span className="font-medium">{item.value}</span></div><Progress value={item.percent} className="mt-2" /><div className="mt-1 text-xs text-muted-foreground">{item.percent}% utilized</div></div>)}
              <div className="pt-4 border-t"><div className="flex justify-between text-sm font-medium"><span>Overall Utilization</span><span className="text-primary">68%</span></div></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>Recent Activities</CardTitle><CardDescription>Latest warehouse operations</CardDescription></div><Button asChild variant="ghost" size="sm"><Link href="/warehouse/activities">View All</Link></Button></CardHeader>
          <CardContent>
            <div className="space-y-4">{[
              { action: 'Stock Received', item: 'Organic Tomatoes', quantity: '500 kg', time: '10 min ago', status: 'completed' },
              { action: 'Stock Dispatched', item: 'Fresh Spinach', quantity: '200 kg', time: '25 min ago', status: 'completed' },
              { action: 'Cold Storage', item: 'Apples (Premium)', quantity: '150 kg', time: '1 hour ago', status: 'in_progress' },
              { action: 'Quality Check', item: 'Organic Grapes', quantity: '100 kg', time: '2 hours ago', status: 'pending' },
            ].map((activity,index)=><div key={index} className="flex items-center gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/50"><div className={cn("rounded-full p-2", activity.status === 'completed' ? 'bg-green-100 text-green-600' : activity.status === 'in_progress' ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-600')}>{activity.status === 'completed' ? <CheckCircle className="h-4 w-4" /> : activity.status === 'in_progress' ? <Clock className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}</div><div className="flex-1 min-w-0"><p className="font-medium">{activity.action}</p><p className="text-sm text-muted-foreground">{activity.item} • {activity.quantity}</p></div><div className="text-right text-sm text-muted-foreground">{activity.time}</div></div>)}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-yellow-200 bg-yellow-50/50">
        <CardHeader><CardTitle className="flex items-center gap-2 text-yellow-700"><AlertTriangle className="h-5 w-5" />Low Stock Alert</CardTitle><CardDescription>Items below minimum threshold - Action required</CardDescription></CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[
            { name: 'Potatoes', stock: 50, min: 100, urgent: true },
            { name: 'Onions', stock: 80, min: 100, urgent: true },
            { name: 'Garlic', stock: 30, min: 50, urgent: false },
            { name: 'Ginger', stock: 20, min: 40, urgent: false },
          ].map((item, index)=><div key={index} className={cn("rounded-lg border p-4", item.urgent ? "border-red-200 bg-red-50" : "border-yellow-200 bg-yellow-50")}><p className="font-medium">{item.name}</p><div className="mt-2 flex items-center justify-between"><span className="text-sm text-muted-foreground">Stock: <span className="font-bold text-red-600">{item.stock}</span> / {item.min}</span><Badge variant={item.urgent ? "destructive" : "warning"}>{item.urgent ? 'Urgent' : 'Low'}</Badge></div><Button size="sm" variant={item.urgent ? "destructive" : "outline"} className="mt-2 w-full">Restock Now</Button></div>)}</div>
        </CardContent>
      </Card>
    </div>
  );
}
