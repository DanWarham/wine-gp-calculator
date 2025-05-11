import { Input } from "@/components/ui/input"
import { GreaterThanRule } from "@/types/rules"
import { safeParse } from "@/lib/gpRules"

export default function GreaterThanRuleForm({
  tempRule,
  setTempRule,
}: {
  tempRule: Partial<GreaterThanRule> | null
  setTempRule: (rule: Partial<GreaterThanRule>) => void
}) {
  return (
    <>
      <p>If cost is greater than:</p>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Min £</label>
        <Input
          className="w-24"
          type="number"
          value={tempRule?.min ?? ''}
          onChange={(e) =>
            setTempRule({
              ...(tempRule as GreaterThanRule),
              min: safeParse(e.target.value),
            })
          }
        />
      </div>
      <p>Then GP is:</p>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">GP %</label>
        <Input
          className="w-24"
          type="number"
          value={tempRule?.gp ?? ''}
          onChange={(e) =>
            setTempRule({
              ...(tempRule as GreaterThanRule),
              gp: safeParse(e.target.value),
            })
          }
        />
      </div>
    </>
  )
}
