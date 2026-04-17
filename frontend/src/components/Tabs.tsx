import type { ReactNode } from 'react'
import {
  Tabs as ShadTabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import type { DashboardTab } from '@/types/dashboard'

type DashboardTabsProps = {
  activeTab: DashboardTab
  onChangeTab: (tab: DashboardTab) => void
  monitoring: ReactNode
  priority: ReactNode
  route: ReactNode
}

function Tabs({ activeTab, onChangeTab, monitoring, priority, route }: DashboardTabsProps) {
  return (
    <ShadTabs
      value={activeTab}
      onValueChange={(value) => onChangeTab(value as DashboardTab)}
      className="space-y-4"
    >
      <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-xl bg-transparent p-0 md:grid-cols-3">
        <TabsTrigger value="monitoring" className="rounded-xl border bg-background/70 py-2">
          Live Monitoring
        </TabsTrigger>
        <TabsTrigger value="priority" className="rounded-xl border bg-background/70 py-2">
          Priority Dispatch
        </TabsTrigger>
        <TabsTrigger value="route" className="rounded-xl border bg-background/70 py-2">
          Route Plan
        </TabsTrigger>
      </TabsList>

      <TabsContent value="monitoring" className="space-y-4">
        {monitoring}
      </TabsContent>
      <TabsContent value="priority" className="space-y-4">
        {priority}
      </TabsContent>
      <TabsContent value="route" className="space-y-4">
        {route}
      </TabsContent>
    </ShadTabs>
  )
}

export default Tabs
