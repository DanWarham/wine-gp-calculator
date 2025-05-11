import { Input } from "@/components/ui/input"
import { BetweenRule } from "@/types/rules"
import { safeParse } from "@/lib/gpRules"

export default function BetweenRuleForm({
  tempRule,
  setTempRule,
}: {
  tempRule: Partial<BetweenRule> | null
  setTempRule: (rule: Partial<BetweenRule>) => void
}) {
  return (
    <>
      <p>If cost is between:</p>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Min £</label>
        <Input
          className="w-24"
          type="number"
          value={tempRule?.min ?? ''}
          onChange={(e) =>
            setTempRule({
              ...(tempRule as BetweenRule),
              min: safeParse(e.target.value),
            })
          }
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Max £</label>
        <Input
          className="w-24"
          type="number"
          value={tempRule?.max ?? ''}
          onChange={(e) =>
            setTempRule({
              ...(tempRule as BetweenRule),
              max: safeParse(e.target.value),
            })
          }
        />
      </div>
      <p>GP scales from:</p>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Start GP%</label>
        <Input
          className="w-24"
          type="number"
          value={tempRule?.start_gp ?? ''}
          onChange={(e) =>
            setTempRule({
              ...(tempRule as BetweenRule),
              start_gp: safeParse(e.target.value),
            })
          }
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">End GP%</label>
        <Input
          className="w-24"
          type="number"
          value={tempRule?.end_gp ?? ''}
          onChange={(e) =>
            setTempRule({
              ...(tempRule as BetweenRule),
              end_gp: safeParse(e.target.value),
            })
          }
        />
      </div>
    </>
  )
}
