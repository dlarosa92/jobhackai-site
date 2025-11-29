#!/usr/bin/env python3
"""
Script to convert DOCX files to PDF format
Uses python-docx to read DOCX and reportlab to create PDF
Requires: pip install python-docx reportlab
"""

from docx import Document
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os
import glob
import re

def clean_text(text):
    """Clean text for PDF rendering"""
    # Replace special characters that might cause issues
    text = text.replace('•', '-')
    text = text.replace('—', '-')
    text = text.replace('–', '-')
    return text

def is_header(line):
    """Check if line is a header"""
    return (
        line.isupper() or
        (len(line) < 50 and line[0].isupper() and '|' not in line) or
        line.startswith('EXPERIENCE') or
        line.startswith('EDUCATION') or
        line.startswith('SKILLS') or
        line.startswith('EXPERIENCIA') or
        line.startswith('EDUCACIÓN') or
        line.startswith('HABILIDADES') or
        line.startswith('WORK EXPERIENCE') or
        line.startswith('CAREER HISTORY') or
        line.startswith('PROFESSIONAL SUMMARY') or
        line.startswith('TECHNICAL SKILLS') or
        line.startswith('CERTIFICATIONS') or
        line.startswith('PROJECTS') or
        line.startswith('PUBLICATIONS') or
        line.startswith('AWARDS') or
        line.startswith('LANGUAGES')
    )

def create_pdf_from_docx(docx_file):
    """Convert DOCX file to PDF"""
    pdf_file = docx_file.replace('.docx', '.pdf')
    
    try:
        # Read DOCX
        doc = Document(docx_file)
        
        # Create PDF
        pdf_doc = SimpleDocTemplate(
            pdf_file,
            pagesize=letter,
            rightMargin=0.75*inch,
            leftMargin=0.75*inch,
            topMargin=0.75*inch,
            bottomMargin=0.75*inch
        )
        
        # Build content
        story = []
        styles = getSampleStyleSheet()
        
        # Custom styles
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=16,
            textColor='black',
            spaceAfter=12,
            alignment=TA_CENTER,
            fontName='Helvetica-Bold'
        )
        
        header_style = ParagraphStyle(
            'CustomHeader',
            parent=styles['Heading2'],
            fontSize=12,
            textColor='black',
            spaceAfter=6,
            spaceBefore=12,
            fontName='Helvetica-Bold'
        )
        
        normal_style = ParagraphStyle(
            'CustomNormal',
            parent=styles['Normal'],
            fontSize=10,
            textColor='black',
            spaceAfter=6,
            leading=12,
            fontName='Helvetica'
        )
        
        bold_style = ParagraphStyle(
            'CustomBold',
            parent=normal_style,
            fontName='Helvetica-Bold'
        )
        
        # Process paragraphs
        for para in doc.paragraphs:
            text = clean_text(para.text.strip())
            
            if not text:
                story.append(Spacer(1, 6))
                continue
            
            # Check formatting from original DOCX
            is_bold = False
            is_center = False
            is_large = False
            
            if para.runs:
                first_run = para.runs[0]
                is_bold = first_run.bold
                # Check alignment
                if para.alignment and para.alignment == 1:  # CENTER
                    is_center = True
            
            # Determine style
            if is_header(text) and not is_bold:
                # Section header
                p = Paragraph(text, header_style)
            elif is_bold and len(text) < 100 and ('@' in text or '|' in text or text[0].isupper()):
                # Name or job title
                style = ParagraphStyle(
                    'CustomBoldCenter',
                    parent=normal_style,
                    fontName='Helvetica-Bold',
                    fontSize=12 if '@' in text or '|' not in text else 10,
                    alignment=TA_CENTER if '@' in text or '|' not in text else TA_LEFT
                )
                p = Paragraph(text, style)
            elif text.startswith('-') or text.startswith('*'):
                # Bullet point
                p = Paragraph(text, normal_style)
            else:
                # Regular text
                style = bold_style if is_bold else normal_style
                p = Paragraph(text, style)
            
            story.append(p)
        
        # Build PDF
        pdf_doc.build(story)
        print(f"Created: {pdf_file}")
        return pdf_file
        
    except Exception as e:
        print(f"Error converting {docx_file} to PDF: {e}")
        # Fallback: create simple PDF from text file
        try:
            text_file = docx_file.replace('.docx', '.txt')
            create_simple_pdf_from_text(text_file, pdf_file)
        except Exception as e2:
            print(f"Fallback also failed: {e2}")
        return None

def create_simple_pdf_from_text(text_file, pdf_file):
    """Fallback: Create simple PDF directly from text file"""
    from reportlab.lib.pagesizes import letter
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    
    pdf_doc = SimpleDocTemplate(pdf_file, pagesize=letter)
    story = []
    styles = getSampleStyleSheet()
    
    with open(text_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    for line in lines:
        line = clean_text(line.strip())
        if not line:
            story.append(Spacer(1, 6))
        else:
            if is_header(line):
                p = Paragraph(line, styles['Heading2'])
            else:
                p = Paragraph(line, styles['Normal'])
            story.append(p)
    
    pdf_doc.build(story)
    print(f"Created (from text): {pdf_file}")

def main():
    # Get all DOCX files in current directory
    docx_files = sorted(glob.glob('resume-*.docx'))
    
    if not docx_files:
        print("No DOCX files found!")
        return
    
    print(f"Found {len(docx_files)} DOCX files to convert...")
    
    for docx_file in docx_files:
        try:
            create_pdf_from_docx(docx_file)
        except Exception as e:
            print(f"Error with {docx_file}: {e}")

if __name__ == '__main__':
    main()






