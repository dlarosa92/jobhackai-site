#!/usr/bin/env python3
"""
Test Resume 2: Complex Formatting with Metadata and Edge Cases
Tests: Metadata filtering, multi-column detection, Unicode handling, encoding issues, boundary detection
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib import colors

# Create PDF with metadata
pdf = SimpleDocTemplate(
    "/home/user/jobhackai-site/test-resume-2-complex-metadata.pdf",
    pagesize=letter,
    rightMargin=0.5*inch,
    leftMargin=0.5*inch,
    topMargin=0.5*inch,
    bottomMargin=0.5*inch,
    title="Resume - José François O'Brien-Müller",
    author="José François O'Brien-Müller",
    subject="Professional Resume",
    creator="Microsoft Word",
    producer="Adobe PDF Library 15.0",
)

styles = getSampleStyleSheet()
story = []

# Add fake metadata as invisible text at the top
metadata_style = ParagraphStyle(
    'Metadata',
    parent=styles['Normal'],
    fontSize=6,
    textColor=colors.Color(0.95, 0.95, 0.95, alpha=0.3),
    spaceAfter=1
)

# Add PDF metadata noise
story.append(Paragraph("PDFFormatVersion=1.7 PageCount=2 Producer=Adobe PDF Library 15.0", metadata_style))
story.append(Paragraph("CreationDate=D:20231215143022-08'00' ModDate=D:20231215143022-08'00'", metadata_style))
story.append(Paragraph("xmp:CreatorTool=Microsoft Word xmpmm:DocumentID=uuid:a1b2c3d4-e5f6-7890-abcd-ef1234567890", metadata_style))
story.append(Paragraph("Tagged=false Encrypted=false IsLinearized=true", metadata_style))
story.append(Spacer(1, 0.1*inch))

# Page marker
page_style = ParagraphStyle('PageMarker', parent=styles['Normal'], fontSize=8, textColor=colors.lightgrey, alignment=2)
story.append(Paragraph("Page 1", page_style))

# Name with Unicode characters
title_style = ParagraphStyle(
    'Title',
    parent=styles['Heading1'],
    fontSize=16,
    alignment=TA_CENTER,
    fontName='Helvetica-Bold',
    spaceAfter=6
)
story.append(Paragraph("José François O'Brien-Müller", title_style))

# Contact
contact_style = ParagraphStyle('Contact', parent=styles['Normal'], fontSize=10, alignment=TA_CENTER, spaceAfter=12)
# Include UTF-8 encoding artifacts that should be cleaned
contact_text = "San José, CA | jose.obrien@email.com | (555) 987-6543"
story.append(Paragraph(contact_text, contact_style))

# Two-column layout using Table (triggers multi-column detection)
heading_style = ParagraphStyle('Heading', fontSize=11, fontName='Helvetica-Bold', spaceAfter=4, spaceBefore=8)
small_text_style = ParagraphStyle('SmallText', fontSize=9, spaceAfter=2)

# LEFT COLUMN
left_col = []
left_col.append(Paragraph("EXPERIENCE", heading_style))
left_col.append(Paragraph("Senior Data Analyst", small_text_style))
left_col.append(Paragraph("Analytics Corp", small_text_style))
left_col.append(Paragraph("2021 - Present", small_text_style))
left_col.append(Paragraph("• Built ETL pipelines", small_text_style))
left_col.append(Paragraph("• Analyzed datasets", small_text_style))
left_col.append(Paragraph("• Created dashboards", small_text_style))
left_col.append(Paragraph("• Automated reporting", small_text_style))
left_col.append(Paragraph("• Led team meetings", small_text_style))
left_col.append(Spacer(1, 0.1*inch))
left_col.append(Paragraph("Data Analyst", small_text_style))
left_col.append(Paragraph("DataTech Inc", small_text_style))
left_col.append(Paragraph("2019 - 2021", small_text_style))
left_col.append(Paragraph("• SQL queries", small_text_style))
left_col.append(Paragraph("• Data cleaning", small_text_style))
left_col.append(Paragraph("• Report generation", small_text_style))
left_col.append(Paragraph("• Visualization", small_text_style))

# RIGHT COLUMN
right_col = []
right_col.append(Paragraph("EDUCATION", heading_style))
right_col.append(Paragraph("M.S. Data Science", small_text_style))
right_col.append(Paragraph("Stanford University", small_text_style))
right_col.append(Paragraph("2019", small_text_style))
right_col.append(Spacer(1, 0.1*inch))
right_col.append(Paragraph("B.S. Mathematics", small_text_style))
right_col.append(Paragraph("UC Berkeley", small_text_style))
right_col.append(Paragraph("2017", small_text_style))
right_col.append(Spacer(1, 0.15*inch))
right_col.append(Paragraph("SKILLS", heading_style))
right_col.append(Paragraph("• Python, R, SQL", small_text_style))
right_col.append(Paragraph("• Pandas, NumPy", small_text_style))
right_col.append(Paragraph("• Tableau, PowerBI", small_text_style))
right_col.append(Paragraph("• Excel, VBA", small_text_style))
right_col.append(Paragraph("• Machine Learning", small_text_style))
right_col.append(Paragraph("• Statistical Analysis", small_text_style))
right_col.append(Paragraph("• Data Visualization", small_text_style))
right_col.append(Paragraph("• ETL Development", small_text_style))
right_col.append(Spacer(1, 0.15*inch))
right_col.append(Paragraph("CERTIFICATIONS", heading_style))
right_col.append(Paragraph("• AWS Certified", small_text_style))
right_col.append(Paragraph("• Data Analyst Pro", small_text_style))

# Create two-column table
data = [[left_col, right_col]]
col_table = Table(data, colWidths=[3.5*inch, 3.5*inch])
col_table.setStyle(TableStyle([
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('LEFTPADDING', (0,0), (-1,-1), 0),
    ('RIGHTPADDING', (0,0), (-1,-1), 0),
]))
story.append(col_table)

# Add metadata noise at bottom
story.append(Spacer(1, 0.5*inch))
story.append(Paragraph("CMYKPROCESS Grays0C=0.0 0.0 0.0 0.0 Grays1C=10.0 10.0 10.0 0.0", metadata_style))
story.append(Paragraph("Tagged=false Encrypted=false IsLinearized=true FileSize=245678", metadata_style))
story.append(Paragraph("uuid:12345678-90ab-cdef-1234-567890abcdef Thumbnail/JPEG", metadata_style))
story.append(Paragraph("photoshop:ColorMode=3 tiff:Orientation=1 exif:PixelXDimension=2550", metadata_style))

# Build PDF
pdf.build(story)
print("✓ Generated: test-resume-2-complex-metadata.pdf")
