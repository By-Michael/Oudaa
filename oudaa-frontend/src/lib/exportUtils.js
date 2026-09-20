import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import html2canvas from 'html2canvas'

const BRAND = [21, 84, 214] // #1554d6

/**
 * Export an array of row-objects to a formatted .xlsx workbook.
 * `columns` = [{ header: 'Name', key: 'name', width: 20, money: false }]
 */
export function exportToExcel({ filename, sheetName = 'Sheet1', columns, rows, meta }) {
  const wb = XLSX.utils.book_new()

  // Optional meta/summary block above the table (title, generated date, totals…)
  const metaRows = meta ? meta.map((m) => [m.label, m.value]) : []

  const header = columns.map((c) => c.header)
  const body = rows.map((r) => columns.map((c) => (typeof c.value === 'function' ? c.value(r) : r[c.key])))

  const aoa = [...metaRows, ...(metaRows.length ? [[]] : []), header, ...body]
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  ws['!cols'] = columns.map((c) => ({ wch: c.width || 18 }))

  // Bold the header row
  const headerRowIdx = metaRows.length + (metaRows.length ? 1 : 0)
  columns.forEach((_, i) => {
    const cellRef = XLSX.utils.encode_cell({ r: headerRowIdx, c: i })
    if (ws[cellRef]) ws[cellRef].s = { font: { bold: true } }
  })

  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

/**
 * Export several sheets in one workbook, e.g. { Residents: {columns, rows}, Payments: {...} }
 */
export function exportMultiSheetExcel(filename, sheets) {
  const wb = XLSX.utils.book_new()
  Object.entries(sheets).forEach(([sheetName, { columns, rows }]) => {
    const header = columns.map((c) => c.header)
    const body = rows.map((r) => columns.map((c) => (typeof c.value === 'function' ? c.value(r) : r[c.key])))
    const ws = XLSX.utils.aoa_to_sheet([header, ...body])
    ws['!cols'] = columns.map((c) => ({ wch: c.width || 18 }))
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  })
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

/**
 * Export a titled, paginated PDF report with an optional summary block and a data table.
 */
export function exportToPdf({ filename, title, subtitle, meta, columns, rows, orientation = 'portrait' }) {
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFillColor(...BRAND)
  doc.rect(0, 0, pageWidth, 64, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 32, 32)
  if (subtitle) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(subtitle, 32, 48)
  }

  let cursorY = 84
  doc.setTextColor(30, 30, 40)

  if (meta && meta.length) {
    doc.setFontSize(10)
    const colWidth = (pageWidth - 64) / Math.min(meta.length, 4)
    meta.forEach((m, i) => {
      const col = i % 4
      const row = Math.floor(i / 4)
      const x = 32 + col * colWidth
      const y = cursorY + row * 34
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(120, 126, 150)
      doc.text(String(m.label).toUpperCase(), x, y)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(20, 24, 40)
      doc.setFontSize(12)
      doc.text(String(m.value), x, y + 16)
      doc.setFontSize(10)
    })
    cursorY += Math.ceil(meta.length / 4) * 34 + 14
  }

  autoTable(doc, {
    startY: cursorY,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => (typeof c.value === 'function' ? c.value(r) : r[c.key]))),
    styles: { fontSize: 9, cellPadding: 6, textColor: [40, 44, 60] },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 248, 253] },
    margin: { left: 32, right: 32 },
    didDrawPage: () => {
      const pageCount = doc.internal.getNumberOfPages()
      doc.setFontSize(8)
      doc.setTextColor(150, 150, 160)
      doc.text(
        `Generated ${new Date().toLocaleString('en-GB')} · Page ${doc.internal.getCurrentPageInfo().pageNumber} of ${pageCount}`,
        32,
        doc.internal.pageSize.getHeight() - 20
      )
    },
  })

  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}

/**
 * Screenshot a DOM node (e.g. a chart container) to a PNG data URL for embedding in a PDF.
 * Returns null if the element isn't available so callers can skip it gracefully.
 */
export async function captureChartImage(el) {
  if (!el) return null
  try {
    const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2, logging: false })
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  } catch {
    return null
  }
}

/**
 * Export a rich, multi-page PDF: a summary page with KPI stats and chart images,
 * followed by one full data table per section (each starting on its own page).
 *
 * kpis:     [{ label, value }]
 * charts:   [{ title, dataUrl, width, height }]
 * sections: [{ title, subtitle, columns, rows }]
 */
export function exportRichPdf({ filename, title, subtitle, kpis, charts, sections }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 32

  function drawHeader(pageTitle, pageSubtitle) {
    doc.setFillColor(...BRAND)
    doc.rect(0, 0, pageWidth, 64, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text(pageTitle, margin, 32)
    if (pageSubtitle) {
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.text(pageSubtitle, margin, 48)
    }
  }

  drawHeader(title, subtitle)
  let y = 84
  doc.setTextColor(30, 30, 40)

  if (kpis && kpis.length) {
    doc.setFontSize(10)
    const perRow = Math.min(kpis.length, 4)
    const colWidth = (pageWidth - margin * 2) / perRow
    kpis.forEach((m, i) => {
      const col = i % perRow
      const row = Math.floor(i / perRow)
      const x = margin + col * colWidth
      const yy = y + row * 34
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(120, 126, 150)
      doc.text(String(m.label).toUpperCase(), x, yy)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(20, 24, 40)
      doc.setFontSize(12)
      doc.text(String(m.value), x, yy + 16)
      doc.setFontSize(10)
    })
    y += Math.ceil(kpis.length / perRow) * 34 + 20
  }

  // Charts, two per row, each captioned.
  const usableCharts = (charts || []).filter((c) => c && c.dataUrl)
  if (usableCharts.length) {
    const gap = 16
    const chartW = (pageWidth - margin * 2 - gap) / 2
    const chartH = chartW * 0.6
    let col = 0
    for (const c of usableCharts) {
      if (y + chartH + 28 > pageHeight - 40) {
        doc.addPage()
        y = 40
        col = 0
      }
      const x = margin + col * (chartW + gap)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(40, 44, 60)
      doc.text(c.title, x, y)
      const ratio = c.width && c.height ? c.height / c.width : 0.6
      const drawH = Math.min(chartH, chartW * ratio)
      doc.addImage(c.dataUrl, 'PNG', x, y + 8, chartW, drawH)
      if (col === 1) {
        y += chartH + 34
        col = 0
      } else {
        col = 1
      }
    }
  }

  // One full table per section, each on its own page.
  for (const s of sections || []) {
    doc.addPage()
    drawHeader(s.title, s.subtitle)
    autoTable(doc, {
      startY: 84,
      head: [s.columns.map((c) => c.header)],
      body: s.rows.map((r) => s.columns.map((c) => (typeof c.value === 'function' ? c.value(r) : r[c.key]))),
      styles: { fontSize: 9, cellPadding: 6, textColor: [40, 44, 60] },
      headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 248, 253] },
      margin: { left: margin, right: margin },
    })
  }

  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 160)
    doc.text(
      `Generated ${new Date().toLocaleString('en-GB')} · Page ${i} of ${pageCount}`,
      margin,
      pageHeight - 20
    )
  }

  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}
