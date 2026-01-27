#!/usr/bin/env python3
"""
Test Resume 3: Edge Case Resume
Tests: Minimum text validation, missing sections, low keyword density, poor formatting,
       grammar issues, minimal content
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

# Create PDF
pdf = SimpleDocTemplate(
    "/home/user/jobhackai-site/test-resume-3-edge-case.pdf",
    pagesize=letter,
    rightMargin=inch,
    leftMargin=inch,
    topMargin=inch,
    bottomMargin=inch
)

styles = getSampleStyleSheet()
story = []

# Very basic styling
basic_style = ParagraphStyle(
    'Basic',
    parent=styles['Normal'],
    fontSize=12,
    spaceAfter=8
)

small_style = ParagraphStyle(
    'Small',
    parent=styles['Normal'],
    fontSize=10,
    spaceAfter=6
)

# Minimal, poorly formatted content
story.append(Paragraph("John Smith", basic_style))
story.append(Paragraph("email@test.com", small_style))
story.append(Spacer(1, 0.2*inch))

# Poor grammar and minimal content - no clear structure
story.append(Paragraph("I worked at company for 3 year. Did many thing. Very good worker.", small_style))
story.append(Spacer(1, 0.15*inch))

# No clear sections, just scattered info
story.append(Paragraph("Skills: computer, microsoft office, internet", small_style))
story.append(Spacer(1, 0.15*inch))

story.append(Paragraph("Education: high school 2015", small_style))
story.append(Spacer(1, 0.15*inch))

# Very generic, no action verbs or metrics
story.append(Paragraph("Responsible for tasks and duties. Helped with projects sometimes. Used email.", small_style))
story.append(Spacer(1, 0.3*inch))

# Minimal footer
tiny_style = ParagraphStyle('Tiny', parent=styles['Normal'], fontSize=8)
story.append(Paragraph("References available", tiny_style))

# Build PDF
pdf.build(story)
print("✓ Generated: test-resume-3-edge-case.pdf")
