export function normalizeSpringPage(data, requestedPage = 0, fallbackSize = 20) {
  const page = Number.isInteger(data?.number)
    ? data.number
    : (Number.isInteger(data?.page) ? data.page : requestedPage)
  return {
    page,
    size: Number.isInteger(data?.size) ? data.size : fallbackSize,
    totalElements: Number.isFinite(data?.totalElements) ? data.totalElements : 0,
    totalPages: Number.isInteger(data?.totalPages) ? data.totalPages : 0
  }
}
