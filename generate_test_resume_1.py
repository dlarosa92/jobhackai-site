#!/usr/bin/env python3
"""
Test Resume 1: Clean, ATS-Friendly Resume
Tests: Basic extraction, section detection, keyword matching, grammar validation
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.enums import TA_CENTER, TA_LEFT

# Create PDF
pdf = SimpleDocTemplate(
    "/home/user/jobhackai-site/test-resume-1-clean-ats.pdf",
    pagesize=letter,
    rightMargin=0.75*inch,
    leftMargin=0.75*inch,
    topMargin=0.75*inch,
    bottomMargin=0.75*inch
)

styles = getSampleStyleSheet()
story = []

# Custom styles
title_style = ParagraphStyle(
    'CustomTitle',
    parent=styles['Heading1'],
    fontSize=16,
    textColor='black',
    spaceAfter=6,
    alignment=TA_CENTER,
    fontName='Helvetica-Bold'
)

contact_style = ParagraphStyle(
    'Contact',
    parent=styles['Normal'],
    fontSize=10,
    alignment=TA_CENTER,
    spaceAfter=12
)

heading_style = ParagraphStyle(
    'CustomHeading',
    parent=styles['Heading2'],
    fontSize=12,
    textColor='black',
    spaceAfter=6,
    spaceBefore=12,
    fontName='Helvetica-Bold'
)

subheading_style = ParagraphStyle(
    'SubHeading',
    parent=styles['Normal'],
    fontSize=11,
    fontName='Helvetica-Bold',
    spaceAfter=2
)

date_style = ParagraphStyle(
    'DateStyle',
    parent=styles['Normal'],
    fontSize=9,
    fontName='Helvetica-Oblique',
    spaceAfter=4
)

body_style = ParagraphStyle(
    'BodyText',
    parent=styles['Normal'],
    fontSize=10,
    spaceAfter=3,
    leftIndent=0
)

# Build resume content
story.append(Paragraph("Sarah Johnson", title_style))
story.append(Paragraph("San Francisco, CA | sarah.johnson@email.com | (555) 123-4567 | linkedin.com/in/sarahjohnson", contact_style))

story.append(Paragraph("PROFESSIONAL SUMMARY", heading_style))
story.append(Paragraph(
    "Results-driven Senior Software Engineer with 8+ years of experience in full-stack development. "
    "Expertise in React, Node.js, Python, and cloud architecture. Proven track record of delivering "
    "scalable applications and leading cross-functional teams. Strong problem-solving skills with "
    "focus on code quality and performance optimization.",
    body_style
))

story.append(Paragraph("PROFESSIONAL EXPERIENCE", heading_style))
story.append(Paragraph("Senior Software Engineer | TechCorp Inc. | San Francisco, CA", subheading_style))
story.append(Paragraph("June 2020 - Present", date_style))
story.append(Paragraph("• Led development of microservices architecture using Node.js, Express, and PostgreSQL, improving system scalability by 40%", body_style))
story.append(Paragraph("• Architected and implemented RESTful APIs serving 2M+ daily requests with 99.9% uptime", body_style))
story.append(Paragraph("• Mentored team of 5 junior engineers, conducting code reviews and establishing best practices", body_style))
story.append(Paragraph("• Implemented CI/CD pipeline using Jenkins and Docker, reducing deployment time by 60%", body_style))
story.append(Paragraph("• Collaborated with product managers and designers to deliver features for 500K+ active users", body_style))
story.append(Spacer(1, 0.1*inch))

story.append(Paragraph("Software Engineer | DataSolutions LLC | San Jose, CA", subheading_style))
story.append(Paragraph("January 2018 - May 2020", date_style))
story.append(Paragraph("• Developed responsive web applications using React, Redux, and TypeScript", body_style))
story.append(Paragraph("• Optimized database queries and implemented caching strategies, reducing load times by 50%", body_style))
story.append(Paragraph("• Built data visualization dashboards using D3.js and Chart.js for business intelligence", body_style))
story.append(Paragraph("• Participated in Agile development process with 2-week sprints and daily standups", body_style))
story.append(Paragraph("• Integrated third-party APIs including Stripe, SendGrid, and AWS services", body_style))
story.append(Spacer(1, 0.1*inch))

story.append(Paragraph("Junior Software Developer | StartupHub | Palo Alto, CA", subheading_style))
story.append(Paragraph("June 2016 - December 2017", date_style))
story.append(Paragraph("• Developed and maintained features for customer-facing web application using JavaScript and Python", body_style))
story.append(Paragraph("• Wrote unit and integration tests achieving 85% code coverage using Jest and Pytest", body_style))
story.append(Paragraph("• Fixed bugs and implemented enhancements based on user feedback and analytics", body_style))
story.append(Paragraph("• Collaborated with QA team to ensure software quality and reliability", body_style))

story.append(Paragraph("EDUCATION", heading_style))
story.append(Paragraph("Bachelor of Science in Computer Science", subheading_style))
story.append(Paragraph("University of California, Berkeley | Graduated: May 2016 | GPA: 3.7/4.0", body_style))

story.append(Paragraph("TECHNICAL SKILLS", heading_style))
story.append(Paragraph("<b>Programming Languages:</b> JavaScript, TypeScript, Python, Java, SQL", body_style))
story.append(Paragraph("<b>Frontend:</b> React, Redux, Vue.js, HTML5, CSS3, Sass, Webpack", body_style))
story.append(Paragraph("<b>Backend:</b> Node.js, Express, Django, Flask, RESTful APIs, GraphQL", body_style))
story.append(Paragraph("<b>Databases:</b> PostgreSQL, MongoDB, MySQL, Redis", body_style))
story.append(Paragraph("<b>Cloud & DevOps:</b> AWS (EC2, S3, Lambda), Docker, Kubernetes, Jenkins, Git, GitHub Actions", body_style))
story.append(Paragraph("<b>Tools & Methodologies:</b> Agile, Scrum, TDD, CI/CD, Microservices, System Design", body_style))

# Build PDF
pdf.build(story)
print("✓ Generated: test-resume-1-clean-ats.pdf")
