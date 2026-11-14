// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const toast = vi.hoisted(() => vi.fn())
vi.mock("react-hot-toast", () => ({ default: toast }))

import { handleNotificationRoute } from "./notificationRouter"
import { LEGACY_MESSAGE, NO_REFERENCE_MESSAGE } from "./notificationTargets"

describe("handleNotificationRoute fallbacks", () => {
  let navigate
  let onClose

  beforeEach(() => {
    toast.mockClear()
    navigate = vi.fn()
    onClose = vi.fn()
  })

  it("says there is nothing to open, and closes the bell, when there is no reference_id", () => {
    handleNotificationRoute({ type: "TASK_COMPLETED", reference_id: null }, {}, navigate, onClose)

    expect(toast).toHaveBeenCalledWith(NO_REFERENCE_MESSAGE)
    expect(NO_REFERENCE_MESSAGE).toBe("This notification has nothing to open")
    expect(navigate).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("says the notification is from an older version for a legacy type", () => {
    handleNotificationRoute({ type: "SALES_COMMENT", reference_id: "x-1" }, {}, navigate, onClose)

    expect(toast).toHaveBeenCalledWith(LEGACY_MESSAGE)
    expect(navigate).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("gives a type with no entry the same message", () => {
    handleNotificationRoute({ type: "NEVER_HEARD_OF_IT", reference_id: "x-1" }, {}, navigate, onClose)

    expect(toast).toHaveBeenCalledWith(LEGACY_MESSAGE)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("stays quiet for a pending type", () => {
    handleNotificationRoute({ type: "MEETING_REQUEST", reference_id: "m-1" }, {}, navigate, onClose)

    expect(toast).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
