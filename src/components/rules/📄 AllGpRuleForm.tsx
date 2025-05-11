import { Input } from "@/components/ui/input"
import { AllGpRule } from "@/types/rules"
import { safeParse } from "@/lib/gpRules"

export default function AllGpRuleForm({
  tempRule,
  setTempRule,
}: {
  tempRule: Partial<AllGpRule> | null
  setTempRule: (rule: Partial<AllGpRule>) => void
}) {
  return (
    <>
      <p>Universal GP % for all wines:</p>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">GP %</label>
        <Input
          className="w-24"
          type="number"
          value={tempRule?.gp ?? ''}
          onChange={(e) =>
            setTempRule({
              ...(tempRule as AllGpRule),
              gp: safeParse(e.target.value),
            })
          }
        />
      </div>
    </>
  )
}
